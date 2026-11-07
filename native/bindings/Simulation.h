#pragma once
#include "SimulationAbi.h"
#include "core/SimulationConfig.h"
#include "core/SimulationConstants.h"
#include "simulation/BirdFlock.h"
#include "simulation/Goal.h"
#include "simulation/Predator.h"
#include "simulation/SimulationState.h"
#include <boids/boids.h>

namespace boids
{
	// host-facing 코디네이터로 ABI 입력·출력과 소유 도메인 객체의 갱신 순서를 연결합니다.
	// 실제 개체 버퍼와 군집 계산은 FBirdFlock에 위임하고 C ABI에 버퍼를 빌려줍니다.
	// 소유 객체와 외부 뷰의 주소를 유지하기 위해 복사·이동을 금지합니다.
	class FSimulation
	{
	public:
		/** ABI 원본과 도메인 객체를 준비합니다. 유효한 설정을 ABI에 기록하고 Reset한 뒤 Step을 호출합니다. */
		FSimulation() = default;

		FSimulation(const FSimulation&) = delete;

		FSimulation& operator=(const FSimulation&) = delete;

		FSimulation(FSimulation&&) = delete;

		FSimulation& operator=(FSimulation&&) = delete;

		/**
		 * selector에 해당하는 소유 저장소를 가변 ABI 뷰로 빌려주며 설정 import나 상태 갱신은 수행하지 않습니다.
		 * @return 잘못된 selector이면 nullptr입니다. 반환 포인터의 해제·재할당은 허용하지 않습니다.
		 * @note 속도 역할은 Step 후 다시 조회하며 갱신 중인 버퍼에 동시에 접근하지 않아야 합니다.
		 */
		[[nodiscard]] void* GetAbiBuffer(int Selector);

		// 실행 진입점: 검증된 ABI 입력을 한 번 읽고 해당 작업을 수행합니다.
		/**
		 * 검증된 ABI 입력을 읽고 활성 수·시간·군집·포식자를 초기화한 뒤 보간 상태와 목표 위치를 맞춥니다.
		 * 초기 군집 통계를 계산하여 활성 수를 포함한 전체 상태 슬롯을 ABI에 발행합니다.
		 * @param Seed 재현 가능한 군집 초기 배치에 사용할 난수 시드입니다.
		 */
		void Reset(std::uint32_t Seed);

		/**
		 * 검증된 ABI 입력을 한 번 읽고 시간·목표·포식자 → 탐색 → 다음 속도 → 위치 이동·보정 순서로 실행합니다.
		 * @param DeltaTime 초 단위 시간 간격이며 외부 어댑터가 (0, 0.05] 범위를 검증한 값이어야 합니다.
		 * @note 이동 전 위치를 보관하고 모든 군집 작업 완료 후 검사 횟수·통계를 기록하여 ABI에 발행합니다.
		 * @note 같은 인스턴스의 동시·중첩 명령은 지원하지 않으며 현재 활성 수는 Reset에서 변경합니다.
		 */
		void Step(double DeltaTime);

		/** ABI 입력을 읽고 현재 목표 위상으로 목표 위치만 갱신합니다. 시간·위상은 진행하지 않습니다. */
		void UpdateGoal();

		/**
		 * ABI 입력을 읽고 현재 군집 위치를 사용해 포식자의 이전/현재 위치와 속도를 갱신합니다.
		 * @param DeltaTime 초 단위 포식자 이동 간격입니다. 군집과 시뮬레이션 시간은 진행하지 않습니다.
		 */
		void UpdatePredator(double DeltaTime);

		/**
		 * ABI 입력을 읽고 군집·포식자 이전 위치와 이전 목표 위상을 현재 상태에 맞춥니다.
		 * @note 목표 위상 진행량을 0으로 만들고 목표 보간 슬롯만 ABI에 발행합니다.
		 */
		void SnapInterpolation();

		/**
		 * ABI 입력을 읽고 현재 군집의 통계 네 값을 계산해 내부 상태와 ABI 통계 슬롯에 기록합니다.
		 * @note 시간·목표·포식자·군집 위치는 진행하지 않습니다.
		 */
		void UpdateFlockMetrics();

		/** ABI 입력을 읽고 현재 군집 위치·활성 수·탐색 설정으로 후보 탐색 구조만 재구축합니다. */
		void RebuildNeighborSearch();

		/**
		 * ABI 입력에서 장애물이 활성화되어 있으면 군집 침투·속도·이전 위치를 보정하고 통계를 발행합니다.
		 * @note 장애물 비활성 시 보정을 생략하며 시간·속도 역할은 진행하지 않습니다.
		 */
		void ReconcileObstacles();

		/**
		 * ABI 입력이 Soft가 아니면 군집과 포식자를 변경된 경계 안으로 보정합니다.
		 * @note 이 함수는 이전 위치 동기화와 통계 발행을 수행하지 않습니다. 필요한 후속 명령은 호출자가 선택합니다.
		 */
		void ReconcileBounds();

		/**
		 * ABI 입력을 읽고 지정 개체의 군집 규칙별 힘·이웃 수·이웃 인덱스를 진단 버퍼에 기록합니다.
		 * @param BirdIndex 현재 활성 개체 범위의 유효한 인덱스입니다. 군집 이동과 시간 진행은 수행하지 않습니다.
		 */
		void UpdateBirdInspection(int BirdIndex);

		/** ABI 입력과 현재 위치로 탐색을 재구축하고 모든 활성 개체의 가시 이웃 수만 갱신합니다. */
		void RefreshNeighborhoodCounts();

	private:
		/** 요청 설정 수와 구분되는 현재 활성 개체 수를 내부 상태 스냅샷에서 정수로 읽습니다. */
		int GetActiveBirdCount() const;

		/**
		 * 현재 설정·장애물·목표·포식자를 빌리고 활성 개체 수를 복사한 군집 호출 문맥을 만듭니다.
		 * @note 문맥 참조의 대상은 이 인스턴스가 소유하며 군집 호출 완료 전 변경하지 않습니다.
		 */
		FFlockContext CreateFlockContext() const;

		/**
		 * ABI 설정·상태를 독립 스냅샷으로 읽고 활성 장애물 설명을 소유 장애물 객체에 반영합니다.
		 * @note 외부 입력 검증은 반복하지 않습니다. Step 내부에서 다시 호출하면 진행 중 상태를 덮어쓸 수 있습니다.
		 */
		void RefreshInputsFromAbi();

		// 내부 단계는 현재 설정 스냅샷을 사용하며 ABI 입력을 다시 읽지 않습니다.
		/** 내부에 준비된 현재 목표 위상과 월드 범위로 목표 위치를 갱신합니다. ABI 입력은 다시 읽지 않습니다. */
		void UpdateGoalFromCurrentState();

		/** 내부 설정과 현재 군집 위치로 포식자를 갱신합니다. ABI 입력 재조회와 시간 진행은 수행하지 않습니다. */
		void UpdatePredatorFromCurrentState(double DeltaTime);

		/** 군집·포식자 이전 위치와 목표 보간 위상을 현재 상태에 맞춥니다. ABI에는 발행하지 않습니다. */
		void SnapInterpolationState();

		/** 군집 통계를 계산해 내부 State에만 기록합니다. 상태 슬롯의 실제 ABI 발행은 호출자가 선택합니다. */
		void WriteFlockMetrics();

		// ABI 원본과 계산용 스냅샷은 서로 다른 저장소입니다.
		FSimulationAbi Abi;

		FSimulationConfig Config;

		FSimulationState State;

		// 도메인 객체를 값으로 소유하며 단계 순서는 이 코디네이터가 관리합니다.
		FObstacleSet Obstacles;

		FBirdFlock Birds;

		FGoal Goal;

		FPredator Predator;
	};
} // namespace boids
