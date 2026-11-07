#pragma once
#include "collision/ObstacleSet.h"
#include "core/Axis.h"
#include "core/SimulationConfig.h"
#include "core/SimulationConstants.h"
#include "core/Vector3D.h"
#include "simulation/BirdUpdateExecutor.h"
#include "simulation/BirdVectorBuffer.h"
#include "simulation/FlockingResult.h"
#include "simulation/Goal.h"
#include "simulation/NeighborSearch.h"
#include "simulation/Predator.h"
#include <boids/boids.h>
#include <memory>
#include <vector>

namespace boids
{
	// 설정과 actor는 호출 동안만 빌리며 군집 객체에 보관하지 않습니다.
	struct FFlockContext
	{
		const FSimulationConfig& Config;

		const FObstacleSet& Obstacles;

		int ActiveBirdCount;

		const FGoal& Goal;

		const FPredator& Predator;
	};

	struct FBirdFlockMetrics
	{
		/** 활성 개체의 평균 속력입니다(장면 단위/초). */
		double MeanSpeed = 0;

		/** 단위 진행 방향 평균의 길이입니다. 같은 방향일수록 1에 가깝습니다. */
		double HeadingAlignment = 0;

		/** 한 축 이상 월드 반길이를 넘어선 개체 수입니다. */
		double OutsideBirdCount = 0;

		/** 전체 개체·축 중 가장 큰 경계 이탈 거리입니다(장면 단위). */
		double MaxBoundaryExcursion = 0;
	};

	/**
	 * @brief 군집 객체가 소유하는 고정 크기 ABI 버퍼의 대여 뷰입니다.
	 * @note 저장소 주소는 군집 생존 중 유지되며 뷰는 군집 객체 수명에 종속됩니다.
	 * @note 위치·속도는 MaxBirdCount×AxisCount, 이웃은 MaxBirdCount, Inspection은 11개 원소입니다.
	 * @note CommitVelocitiesAndIntegratePositions 후에는 속도 역할 포인터를 다시 조회합니다.
	 */
	struct FBirdFlockBuffers
	{
		float* Positions;

		float* PreviousPositions;

		float* Velocities;

		float* NextVelocities;

		std::uint16_t* NeighborCounts;

		double* Inspection;

		std::uint16_t* InspectionNeighborIndices;
	};

	/**
	 * @brief 고정 크기 군집 버퍼와 이웃 탐색 객체를 소유하며 복사·이동을 금지합니다.
	 * @note 설정·actor는 호출 동안만 빌리며 시간과 단계 순서는 호출자가 관리합니다.
	 * @note 기본 순서는 SnapInterpolation → RebuildNeighborSearch → IntegrateNextVelocities → CommitVelocitiesAndIntegratePositions입니다.
	 * @note 같은 군집의 명령·진단·외부 버퍼 접근은 갱신과 겹치지 않도록 호출자가 조율합니다.
	 */
	class FBirdFlock
	{
	public:
		/**
		 * 군집 버퍼·진단 저장소·이웃 탐색과 개체 갱신 실행기를 준비합니다.
		 * @param RequestedWorkerThreadLimit 호출 스레드 외의 네이티브 워커 상한입니다. 0이면 직렬 실행합니다.
		 * @note 실제 개체 위치·속도는 Reset에서 초기화하며 워커는 첫 병렬 작업에서 생성합니다.
		 */
		explicit FBirdFlock(int RequestedWorkerThreadLimit = constants::MaximumBirdWorkerCount);

		FBirdFlock(const FBirdFlock&) = delete;

		FBirdFlock& operator=(const FBirdFlock&) = delete;

		FBirdFlock(FBirdFlock&&) = delete;

		FBirdFlock& operator=(FBirdFlock&&) = delete;

		// 초기화와 스텝 준비
		/**
		 * 시드로 활성 개체의 위치와 현재 속도를 초기화하고 전체 이웃 수 버퍼를 0으로 만듭니다.
		 * 위치를 생성한 뒤 속력 범위를 적용하고, 장애물이 활성화되어 있으면 침투를 보정합니다.
		 * @param Seed 재현 가능한 초기 배치에 사용할 난수 시드입니다.
		 * @param Context 초기 배치 범위·활성 개체 수·장애물 설정을 제공하는 대여 문맥입니다.
		 * @note 현재/다음 속도 버퍼의 역할은 유지합니다. 이전 위치 복사와 탐색 재구축은 별도 호출입니다.
		 */
		void Reset(std::uint32_t Seed, const FFlockContext& Context);

		/**
		 * 현재 위치 전체를 PreviousPositions에 복사하여 렌더링 보간의 시작 상태를 저장합니다.
		 * 스텝에서는 위치 이동 전에 호출하며 현재 위치·속도와 시뮬레이션 시간은 변경하지 않습니다.
		 */
		void SnapInterpolation();

		/**
		 * 현재 위치·활성 개체 수·설정으로 Grid/KD-tree를 재구축하거나 전수 탐색 후보를 준비합니다.
		 * 이후 정확한 거리·시야 검사는 CollectNeighborhood에서 수행합니다.
		 * @note 위치·활성 수·탐색 설정이 바뀌면 다음 이웃 계산 전에 다시 호출해야 합니다.
		 */
		void RebuildNeighborSearch(const FFlockContext& Context);

		// 진단 조회: 위치와 속도를 변경하지 않습니다.
		/**
		 * 탐색을 재구축하고 지정 개체의 응집·정렬·분리 힘과 이웃 정보를 진단 저장소에 기록합니다.
		 * @param BirdIndex [0, Context.ActiveBirdCount)의 유효한 개체 인덱스입니다.
		 * @note Inspection과 InspectionNeighborIndices를 갱신합니다. 전체 NeighborCounts 배열은 갱신하지 않습니다.
		 * @note 위치·현재/다음 속도는 변경하지 않으며 목표·포식자·장애물 회피 힘은 진단 힘에 포함하지 않습니다.
		 */
		void UpdateBirdInspection(int BirdIndex, const FFlockContext& Context);

		/**
		 * 현재 위치로 탐색을 재구축하고 모든 활성 개체의 거리·시야 조건을 통과한 이웃 수를 기록합니다.
		 * @note NeighborCounts만 갱신하며 선택 개체의 Inspection 출력과 위치·속도는 유지합니다.
		 */
		void RefreshNeighborhoodCounts(const FFlockContext& Context);

		// 스텝 실행: 다음 속도 계산이 모두 끝난 뒤 위치를 갱신합니다.
		/**
		 * 같은 현재 위치·속도 스냅샷으로 모든 활성 개체의 다음 속도를 계산합니다.
		 * 개체마다 군집 규칙 → 외부 힘 → 최대 힘 제한 → 속도 적분 → 속력 제한을 수행합니다.
		 * @param DeltaTimeSeconds 적분 간격이며 단위는 초입니다.
		 * @param Context 이번 계산에서 공유할 설정·활성 수·장애물·목표·포식자 문맥입니다.
		 * @return 자신을 제외한 후보에 대해 수행한 거리 검사 횟수의 합계입니다.
		 * @note 같은 설정·활성 수·위치로 RebuildNeighborSearch를 먼저 호출해야 합니다.
		 * @note 개체 저장소에서는 NextVelocities와 NeighborCounts를 갱신하며 현재 위치·속도와 속도 역할은 유지합니다.
		 */
		double IntegrateNextVelocities(double DeltaTimeSeconds, const FFlockContext& Context);

		/**
		 * 현재/다음 속도 역할을 한 번 교체하고 새 속도로 모든 활성 개체의 위치를 이동합니다.
		 * 각 개체는 위치 적분 → 활성 장애물 침투·반사 보정 → 경계·속력 보정 순서로 처리합니다.
		 * @param DeltaTimeSeconds 다음 속도 계산에 사용한 것과 같은 초 단위 적분 간격입니다.
		 * @note 같은 활성 개체 전체의 IntegrateNextVelocities 완료 후 한 스텝에 한 번 호출합니다.
		 * @note 네이티브 병렬 작업이 모두 끝난 뒤 반환합니다. 이전 위치 복사는 별도로 수행합니다.
		 * @note 호출 후 ABI 속도 역할 포인터는 GetAbiBuffers로 다시 조회해야 합니다.
		 */
		void CommitVelocitiesAndIntegratePositions(double DeltaTimeSeconds, const FFlockContext& Context);

		// 설정 변경 후 위치·속도 보정
		/**
		 * 편집된 장애물에 맞춰 각 개체의 침투 위치·반사 속도·속력을 보정합니다.
		 * 모든 개체의 작업 완료 후 이전 위치를 현재 위치에 맞춰 편집 전 위치와의 보간을 방지합니다.
		 * @note 시간과 속도 버퍼 역할은 진행하지 않습니다. 장애물 활성 여부는 호출자가 판단합니다.
		 */
		void ReconcileObstacles(const FFlockContext& Context);

		/**
		 * 경계·속력 → 활성 장애물 → 경계·속력 보정을 개체마다 수행하고 전체 완료 후 반환합니다.
		 * Soft 모드는 위치를 월드 안으로 제한하지 않으며 속력과 활성 장애물 보정은 수행합니다.
		 * @note 시간·이전 위치·속도 버퍼 역할은 변경하지 않습니다. 보간 상태 동기화는 호출자가 결정합니다.
		 */
		void ReconcileBounds(const FFlockContext& Context);

		// 통계와 버퍼 조회
		/**
		 * 현재 활성 개체의 평균 속력, 단위 진행 방향의 정렬도, 경계 밖 개수와 최대 이탈 거리를 계산합니다.
		 * @return 군집 저장소와 독립된 통계 값입니다. 상태·ABI 발행은 호출자가 수행합니다.
		 * @pre Context.ActiveBirdCount > 0이어야 하며 개체 갱신 작업이 완료되어 있어야 합니다.
		 */
		[[nodiscard]] FBirdFlockMetrics CalculateMetrics(const FFlockContext& Context) const;

		/**
		 * 군집이 소유하는 위치·속도·이웃·진단 저장소의 현재 ABI 뷰를 반환합니다.
		 * @return 소유권을 이전하지 않는 가변 포인터 묶음입니다. 군집 소멸 후 사용할 수 없습니다.
		 * @note 각 저장소의 주소는 고정이지만 속도 역할 포인터는 Commit 호출마다 교체됩니다.
		 * @note 병렬 갱신 중 외부에서 이 뷰를 읽거나 쓰지 않아야 합니다.
		 */
		[[nodiscard]] FBirdFlockBuffers GetAbiBuffers();

		/**
		 * 현재 위치 저장소를 계산용 읽기 전용 참조로 빌려줍니다.
		 * @return 군집 수명에 종속된 뷰입니다. 값 복사가 아니므로 이후 이동 결과가 같은 뷰에 반영됩니다.
		 * @note 위치를 수정하는 병렬 갱신과 동시에 읽지 않아야 합니다.
		 */
		[[nodiscard]] const FBirdVectorBuffer& GetPositions() const;

	private:
		// 한 번의 군집 조회에서 모든 개체가 공유하는 설정 파생 값입니다.
		// 호출마다 생성하며 설정 변경 사이에 캐시하지 않습니다.
		struct FNeighborhoodQuery
		{
			double PerceptionRadius;

			double PerceptionRadiusSquared;

			double HalfFieldOfViewCosine;

			bool bFilterFieldOfView;
		};

		struct FFlockingAccumulator
		{
			FVector3D PositionSum;

			FVector3D VelocitySum;

			FVector3D SeparationSum;

			int VisibleNeighborCount = 0;

			int CloseNeighborCount = 0;

			int DistanceCheckCount = 0;
		};

		struct FBoundarySteering
		{
			FVector3D Force;

			double OutsideBlendWeight = 0;
		};

		// 규칙별 힘의 값 결과입니다. 계산 함수는 진단 저장소를 변경하지 않습니다.
		struct FFlockingForces
		{
			FVector3D Cohesion;

			FVector3D Alignment;

			FVector3D Separation;
		};

		// 속력 제한과 초기화 보조
		/**
		 * 지정 개체의 속도를 최소 5·최대 12의 속력 범위로 제한합니다.
		 * 거의 정지한 경우 방향을 정할 수 없으므로 +X 방향 최소 속도를 저장합니다.
		 * @param Buffer 현재 또는 다음 속도 저장소이며 이 인자로 받은 버퍼만 수정합니다.
		 */
		static void EnforceBirdSpeedRange(FBirdVectorBuffer& Buffer, int BirdIndex);

		/**
		 * 인지 반경의 제곱과 반시야각 코사인을 미리 계산하여 한 번의 전체 군집 조회에서 공유합니다.
		 * @return Config에서 파생된 독립 값이며 설정 변경 사이에 캐시하지 않습니다.
		 */
		static FNeighborhoodQuery CreateNeighborhoodQuery(const FSimulationConfig& Config);

		/**
		 * Mulberry32 난수 상태를 한 번 진행하고 [0, 1)의 double 값을 반환합니다.
		 * @note Reset의 개체·축 순서에 따라 상태를 소비합니다. 같은 군집에서 동시에 호출하지 않습니다.
		 */
		double RandomValue();

		// 이웃 수집과 군집 규칙 계산
		/**
		 * 이웃 누적 결과로 응집·정렬·분리 힘을 계산하고 군집 합력과 검사·이웃 수를 반환합니다.
		 * @param bWriteInspection true이면 선택 개체의 이웃 인덱스와 규칙별 힘을 진단 버퍼에 기록합니다.
		 * @note 목표·포식자·장애물·경계 힘은 포함하지 않습니다. 공통 후보 버퍼를 사용하므로 동시 호출하지 않습니다.
		 */
		FFlockingResult EvaluateFlocking(const FFlockContext& Context, const FNeighborhoodQuery& Query, int BirdIndex, bool bWriteInspection = false);

		/**
		 * 탐색 후보에서 자신을 제외하고 거리 조건을 검사하여 군집 규칙의 입력을 누적합니다.
		 * 인지 반경 안의 근접 분리는 시야 검사 전에 누적하며 응집·정렬은 시야를 통과한 이웃만 사용합니다.
		 * @return 이웃 위치·속도·분리 벡터의 합과 근접/가시 이웃 수, 실제 후보 거리 검사 횟수입니다.
		 * @note bWriteInspection이 true일 때만 가시 이웃 인덱스를 기록합니다. Search 재구축이 선행되어야 합니다.
		 */
		FFlockingAccumulator CollectNeighborhood(const FNeighborhoodQuery& Query, int BirdIndex, bool bWriteInspection);

		/**
		 * 이웃 평균 위치로 향하는 응집, 평균 속도에 맞추는 정렬, 근접 개체를 미는 분리 힘을 계산합니다.
		 * @return 설정 가중치가 적용된 세 규칙의 값 결과입니다. 위치·속도·진단 버퍼는 변경하지 않습니다.
		 */
		FFlockingForces CalculateFlockingForces(const FFlockContext& Context, int BirdIndex, const FFlockingAccumulator& Accumulator) const;

		/**
		 * 선택 개체의 응집·정렬·분리 XYZ와 가시/근접 이웃 수를 Inspection 슬롯에 기록합니다.
		 * @note 이웃 인덱스는 CollectNeighborhood에서 기록합니다. 유효 인덱스 수는 가시 이웃 수로 판단합니다.
		 */
		void PublishBirdInspection(const FFlockingAccumulator& Accumulator, const FFlockingForces& Forces);

		// 외부 힘과 속도 적분
		/**
		 * 군집 합력에 활성 목표 인력 → 현재 포식자 회피 → 예상 위치의 장애물 회피를 순서대로 누적합니다.
		 * 마지막에는 경계 모드에 따라 기존 힘을 감쇠하고 경계 조향을 혼합합니다.
		 * @param InOutForce 입력 군집 힘에 외부 힘과 경계 조향을 반영하여 돌려주는 누적 벡터입니다.
		 * @note 힘만 변경하며 개체의 위치·속도를 직접 수정하지 않습니다.
		 */
		void AccumulateExternalForces(const FFlockContext& Context, int BirdIndex, FVector3D& InOutForce) const;

		/**
		 * 합력의 크기를 최대 조향력으로 제한하고 현재 속도에 Force × dt를 더해 다음 속도를 저장합니다.
		 * 저장 시 float로 변환한 뒤 허용 속력 범위를 적용합니다.
		 * @note 지정 개체의 NextVelocities만 변경하며 현재 속도·위치와 버퍼 역할은 유지합니다.
		 */
		void IntegrateBirdVelocity(int BirdIndex, const FVector3D& Force, double DeltaTimeSeconds);

		// 장애물 접촉과 이동 후 보정
		/**
		 * 현재 위치와 각 장애물의 부호 있는 표면 거리로 침투 여부를 검사하여 실제 접촉을 보정합니다.
		 * 장애물마다 위치 투영 → 안쪽 방향 속도 반사 → 속력 제한을 수행하고 다음 장애물에 결과를 전달합니다.
		 * @note 지정 개체의 현재 위치·속도를 수정합니다. 장애물 순서는 계산 결과에 영향을 주므로 유지합니다.
		 */
		void ResolveObstacles(const FFlockContext& Context, int BirdIndex);

		/**
		 * 표면 법선 방향으로 ProjectionDistance만큼 개체를 밀어내어 장애물 표면 밖 여유 거리를 확보합니다.
		 * @note 위치만 수정하며 Soft 경계가 아니면 축별 위치를 월드 범위로 다시 제한합니다.
		 */
		void ProjectBirdOutsideObstacle(const FFlockContext& Context, int BirdIndex, const FVector3D& SurfaceNormal, double ProjectionDistance);

		/**
		 * 현재 속도와 표면 법선의 내적으로 장애물 안쪽을 향하는지 확인하고 법선 속도 성분을 반사 보정합니다.
		 * @note 이미 바깥쪽을 향하는 속도는 유지합니다. 위치 수정과 속력 제한은 별도 단계입니다.
		 */
		void ReflectBirdVelocityFromObstacle(int BirdIndex, const FVector3D& SurfaceNormal);

		/**
		 * Hard·Hybrid 모드에서는 경계 밖 위치를 제한하고 해당 축의 속도를 안쪽으로 향하게 합니다.
		 * 모든 모드에서 마지막에 속력 범위를 적용합니다. Soft 모드의 위치는 월드 밖에서도 유지합니다.
		 */
		void EnforceBirdBoundsAndSpeed(const FFlockContext& Context, int BirdIndex);

		// 경계 조향과 장애물 회피
		/**
		 * 경계 여유 구간에서 안쪽 조향력을 만들고 정면 접근 정도에 따라 접선 회전력을 추가합니다.
		 * @return Force와 경계 밖 이탈 정도에 따른 [0, 1] 혼합 가중치입니다.
		 * @note 위치·속도는 읽기만 하며, 기존 군집 힘과의 혼합은 BlendBoundarySteering에서 수행합니다.
		 */
		FBoundarySteering CalculateBoundarySteering(const FFlockContext& Context, int BirdIndex) const;

		/**
		 * 법선과 평행해지지 않는 접선 기준을 얻도록 절댓값이 가장 작은 법선 성분의 축을 선택합니다.
		 * @return 동률이면 X → Y → Z 순서로 선택한 축입니다. 같은 입력에서 같은 회전 방향을 유지합니다.
		 */
		static EAxis SelectBoundaryTangentAxis(const FVector3D& InwardNormal);

		/**
		 * 선택한 기준 축을 법선에 수직인 평면으로 투영하고 경계 힘·회전 가중치를 적용해 누적합니다.
		 * @param InOutForce 안쪽 조향력에 접선 회전력을 추가할 벡터입니다. 개체 상태는 수정하지 않습니다.
		 */
		static void AccumulateBoundaryTangentForce(const FVector3D& InwardNormal, double BoundaryForceMagnitude, double TurnWeight, FVector3D& InOutForce);

		/**
		 * 현재 속도로 0.45초 후의 위치를 예측하고 각 활성 장애물 표면에서 멀어지는 조향력을 누적합니다.
		 * 예상 위치의 부호 있는 표면 거리가 4 미만이면 형상별 감쇠 길이에 따라 바깥 법선 방향 힘을 더합니다.
		 * @param InOutForce 기존 힘을 유지하면서 장애물별 회피 힘을 더할 벡터입니다.
		 * @note 장애물 비활성 시 변경하지 않습니다. 실제 침투 위치·속도 보정은 ResolveObstacles가 담당합니다.
		 */
		void AccumulateObstacleAvoidanceForce(const FFlockContext& Context, int BirdIndex, FVector3D& InOutForce) const;

		/**
		 * Soft·Hybrid 모드에서 경계 이탈 가중치만큼 기존 힘을 줄이고 경계 조향력을 더합니다.
		 * @note Hard 모드에서는 InOutForce를 유지합니다. 위치를 강제로 제한하는 단계와 구분합니다.
		 */
		void BlendBoundarySteering(const FFlockContext& Context, int BirdIndex, FVector3D& InOutForce) const;

		// 위치 저장소: 이동 상태와 렌더링 보간용 이전 상태를 각각 소유합니다.
		FBirdVectorBuffer Positions;

		FBirdVectorBuffer PreviousPositions;

		// 속도 저장소는 고정하며, 비소유 포인터의 역할만 스텝 완료 시 교체합니다.
		FBirdVectorBuffer VelocityA;

		FBirdVectorBuffer VelocityB;

		FBirdVectorBuffer* Velocities;

		FBirdVectorBuffer* NextVelocities;

		// 전체 개체의 이웃 수와 선택 개체의 진단 출력을 소유합니다.
		std::vector<std::uint16_t> NeighborCounts;

		std::vector<std::uint16_t> InspectionNeighborIndices;

		std::vector<double> Inspection;

		// 재현 가능한 초기화에 사용하는 난수 상태입니다.
		std::uint32_t RandomState;

		// 후보 탐색 구조를 단독 소유하며, 정확한 거리·시야 검사는 군집에서 수행합니다.
		std::unique_ptr<FNeighborSearch> Search;

		// 가장 먼저 소멸하여 워커를 join한 뒤 군집 버퍼와 탐색 저장소를 해제합니다.
		FBirdUpdateExecutor BirdUpdateExecutor;
	};
} // namespace boids
