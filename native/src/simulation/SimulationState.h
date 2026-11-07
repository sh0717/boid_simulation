#pragma once

namespace boids
{
	// ABI에서 검증된 전체 상태를 가져오거나 독립 복사할 때 사용하는 값 묶음입니다.
	// 이 DTO의 변경은 FSimulationState나 ABI 저장소를 자동으로 변경하지 않습니다.
	struct FSimulationStateSnapshot
	{
		double ActiveBirdCount = 0;

		// 시뮬레이션 시간과 목표 보간 위상(초)
		double SimulationTime = 0;

		double GoalPhaseTime = 0;

		double PreviousGoalPhaseTime = 0;

		double GoalPhaseAdvance = 0;

		// 마지막으로 기록한 검사 횟수와 군집 통계
		double NeighborDistanceChecks = 0;

		double MeanSpeed = 0;

		double HeadingAlignment = 0;

		double OutsideBirdCount = 0;

		double MaxBoundaryExcursion = 0;
	};

	// 시간·위상·보간 상태의 연동 갱신을 소유합니다. 외부에는 const 조회만 제공합니다.
	// ABI import는 전체 snapshot으로 구성하며 반영 범위와 시점은 상위 계층이 선택합니다.
	class FSimulationState
	{
	public:
		/** 시간·위상·통계를 모두 0인 내부 스냅샷으로 준비합니다. 활성 수 설정은 ResetForBirdCount가 담당합니다. */
		FSimulationState() = default;

		/** 전달받은 전체 스냅샷을 값으로 소유합니다. 원본 스냅샷이나 ABI 저장소를 빌리지 않습니다. */
		explicit FSimulationState(const FSimulationStateSnapshot& Snapshot)
			: Values(Snapshot)
		{
		}

		/**
		 * 현재 내부 상태를 객체 수명에 종속된 읽기 전용 참조로 반환합니다.
		 * @note 다음 명령이 같은 저장소를 변경합니다. 이전 값을 보존하려면 반환 결과를 값으로 복사합니다.
		 */
		[[nodiscard]] const FSimulationStateSnapshot& GetSnapshot() const noexcept;

		/**
		 * 활성 수를 설정하고 시간·목표 위상·보간 진행량·이웃 거리 검사 횟수를 초기화합니다.
		 * @note 군집 통계 네 값은 유지되므로 호출자는 초기 배치 후 측정값으로 별도 갱신해야 합니다.
		 */
		void ResetForBirdCount(int BirdCount);

		/**
		 * 시뮬레이션 시간을 진행하고 진행 전 목표 위상을 보간용 이전 위상으로 저장합니다.
		 * @param DeltaTimeSeconds 초 단위 시간 간격입니다.
		 * @note 목표가 활성화된 경우에만 dt × GoalSpeedMultiplier로 목표 위상을 진행하고 주기 안으로 감쌉니다.
		 * @note 위상 진행량은 별도로 보관하며 개체·목표 위치 계산과 ABI 발행은 수행하지 않습니다.
		 */
		void AdvanceTime(double DeltaTimeSeconds, bool bGoalEnabled, double GoalSpeedMultiplier);

		/**
		 * 이전 목표 위상을 현재 위상에 맞추고 이번 위상 진행량을 0으로 만들어 보간의 두 상태를 맞춥니다.
		 * @note 현재 위상과 시뮬레이션 시간은 변경하지 않습니다.
		 */
		void SnapGoalInterpolation();

		/**
		 * 측정된 평균 속력·방향 정렬도·경계 이탈 개수·최대 이탈 거리를 내부 상태에 기록합니다.
		 * @note 통계를 계산하거나 ABI에 발행하지 않으며 시간·활성 수·검사 횟수도 유지합니다.
		 */
		void SetFlockMetrics(double InMeanSpeed, double InHeadingAlignment, double InOutsideBirdCount, double InMaxBoundaryExcursion);

		/**
		 * 이번 계산의 거리 검사 횟수로 내부 값을 덮어씁니다. 기존 값에 더하지 않습니다.
		 * @note 개체별 누적은 군집 계산에서 완료하며 ABI 발행은 상위 계층이 담당합니다.
		 */
		void RecordNeighborDistanceChecks(double DistanceChecks);

	private:
		FSimulationStateSnapshot Values;
	};
} // namespace boids
