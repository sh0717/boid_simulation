#include "simulation/SimulationState.h"
#include "core/MathUtils.h"
#include <cmath>

namespace boids
{
	const FSimulationStateSnapshot& FSimulationState::GetSnapshot() const noexcept
	{
		return Values;
	}

	void FSimulationState::ResetForBirdCount(int BirdCount)
	{
		Values.ActiveBirdCount = BirdCount;
		Values.SimulationTime = 0;
		Values.GoalPhaseTime = 0;
		Values.PreviousGoalPhaseTime = 0;
		Values.GoalPhaseAdvance = 0;
		Values.NeighborDistanceChecks = 0;
	}

	void FSimulationState::AdvanceTime(double DeltaTimeSeconds, bool bGoalEnabled, double GoalSpeedMultiplier)
	{
		Values.SimulationTime += DeltaTimeSeconds;
		// 진행 전 위상과 이번 진행량을 따로 보관하여 주기 경계를 넘는 보간도 재현합니다.
		Values.PreviousGoalPhaseTime = Values.GoalPhaseTime;
		Values.GoalPhaseAdvance = bGoalEnabled ? DeltaTimeSeconds * GoalSpeedMultiplier : 0;
		Values.GoalPhaseTime += Values.GoalPhaseAdvance;
		if (Values.GoalPhaseTime >= detail::GoalPathPeriod || Values.GoalPhaseTime < 0)
		{
			const double WrappedPhase = std::fmod(Values.GoalPhaseTime, detail::GoalPathPeriod);
			Values.GoalPhaseTime = std::fmod(WrappedPhase + detail::GoalPathPeriod, detail::GoalPathPeriod);
		}
	}

	void FSimulationState::SnapGoalInterpolation()
	{
		Values.PreviousGoalPhaseTime = Values.GoalPhaseTime;
		Values.GoalPhaseAdvance = 0;
	}

	void FSimulationState::SetFlockMetrics(double InMeanSpeed, double InHeadingAlignment, double InOutsideBirdCount, double InMaxBoundaryExcursion)
	{
		Values.MeanSpeed = InMeanSpeed;
		Values.HeadingAlignment = InHeadingAlignment;
		Values.OutsideBirdCount = InOutsideBirdCount;
		Values.MaxBoundaryExcursion = InMaxBoundaryExcursion;
	}

	void FSimulationState::RecordNeighborDistanceChecks(double DistanceChecks)
	{
		Values.NeighborDistanceChecks = DistanceChecks;
	}
} // namespace boids
