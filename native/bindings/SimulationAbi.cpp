#include "SimulationAbi.h"
#include <cassert>

namespace boids
{
	FSimulationConfig FSimulationAbi::ReadConfigSnapshot() const
	{
		// 슬롯 해석만 담당합니다. 값의 유한성·범위 검증은 호스트 어댑터에서 끝나 있어야 합니다.
		FSimulationConfig Config;
		Config.RequestedBirdCount = static_cast<int>(RawConfig[boids::Count]);
		Config.CohesionWeight = RawConfig[boids::Cohesion];
		Config.AlignmentWeight = RawConfig[boids::Alignment];
		Config.SeparationWeight = RawConfig[boids::Separation];
		Config.PerceptionRadius = RawConfig[boids::Perception];
		Config.FieldOfViewDegrees = RawConfig[boids::FieldOfView];
		Config.bGoalEnabled = RawConfig[boids::GoalEnabled] != 0;
		Config.GoalSpeedMultiplier = RawConfig[boids::GoalSpeed];
		Config.GoalAttractionWeight = RawConfig[boids::GoalStrength];
		Config.bPredatorEnabled = RawConfig[boids::PredatorEnabled] != 0;
		Config.PredatorMaxSpeed = RawConfig[boids::PredatorSpeed];
		Config.PredatorAvoidanceRadius = RawConfig[boids::PredatorRadius];
		Config.PredatorAvoidanceWeight = RawConfig[boids::PredatorStrength];
		Config.bObstaclesEnabled = RawConfig[boids::ObstaclesEnabled] != 0;
		Config.BoundaryMode = DecodeBoundaryMode(RawConfig[boids::BoundaryMode]);
		Config.BoundaryMargin = RawConfig[boids::BoundaryMargin];
		Config.BoundaryStrength = RawConfig[boids::BoundaryStrength];
		Config.SearchMethod = DecodeSearchMethod(RawConfig[boids::SearchType]);
		Config.Bounds.HalfExtents = {RawConfig[boids::HalfX], RawConfig[boids::HalfY], RawConfig[boids::HalfZ]};
		Config.CellSize = RawConfig[boids::CellSize];
		Config.ObstacleCount = static_cast<int>(RawConfig[boids::ObstacleCount]);
		return Config;
	}

	FSimulationState FSimulationAbi::ReadStateSnapshot() const
	{
		FSimulationStateSnapshot Snapshot;
		Snapshot.ActiveBirdCount = RawState[boids::ActiveCount];
		Snapshot.SimulationTime = RawState[boids::Time];
		Snapshot.GoalPhaseTime = RawState[boids::GoalTime];
		Snapshot.PreviousGoalPhaseTime = RawState[boids::PreviousGoalTime];
		Snapshot.GoalPhaseAdvance = RawState[boids::GoalAdvance];
		Snapshot.NeighborDistanceChecks = RawState[boids::NeighborChecks];
		Snapshot.MeanSpeed = RawState[boids::MeanSpeed];
		Snapshot.HeadingAlignment = RawState[boids::Order];
		Snapshot.OutsideBirdCount = RawState[boids::OutsideCount];
		Snapshot.MaxBoundaryExcursion = RawState[boids::MaxExcursion];
		return FSimulationState(Snapshot);
	}

	FObstacleDescriptorSnapshot FSimulationAbi::ReadObstacleSnapshot(int ActiveObstacleCount) const
	{
		assert(ActiveObstacleCount >= 0 && ActiveObstacleCount <= MaxObstacles);
		FObstacleDescriptorSnapshot Snapshot;
		Snapshot.ActiveObstacleCount = ActiveObstacleCount;
		for (int ObstacleIndex = 0; ObstacleIndex < ActiveObstacleCount; ++ObstacleIndex)
		{
			const double* Record = RawObstacleRecords.data() + ObstacleIndex * constants::ObstacleStride;
			FObstacleDescriptor& Descriptor = Snapshot.Descriptors[ObstacleIndex];
			Descriptor.Shape = Record[constants::ObstacleTypeOffset] == constants::SphereObstacleType ? EObstacleShape::Sphere : EObstacleShape::Box;
			for (EAxis Axis : AllAxes)
			{
				Descriptor.Center[Axis] = Record[constants::ObstaclePositionOffset + ToIndex(Axis)];
				Descriptor.Dimensions[Axis] = Record[constants::ObstacleDimensionsOffset + ToIndex(Axis)];
			}
			Descriptor.Radius = Record[constants::ObstacleRadiusOffset];
		}
		return Snapshot;
	}

	void FSimulationAbi::PublishResetState(const FSimulationState& State)
	{
		RawState[boids::ActiveCount] = State.GetSnapshot().ActiveBirdCount;
		PublishStepState(State);
	}

	void FSimulationAbi::PublishStepState(const FSimulationState& State)
	{
		const FSimulationStateSnapshot& Snapshot = State.GetSnapshot();
		// Step은 활성 수를 덮어쓰지 않습니다. 활성 수 변경은 Reset의 발행 계약입니다.
		RawState[boids::Time] = Snapshot.SimulationTime;
		RawState[boids::GoalTime] = Snapshot.GoalPhaseTime;
		PublishGoalInterpolationState(State);
		RawState[boids::NeighborChecks] = Snapshot.NeighborDistanceChecks;
		PublishFlockMetrics(State);
	}

	void FSimulationAbi::PublishGoalInterpolationState(const FSimulationState& State)
	{
		const FSimulationStateSnapshot& Snapshot = State.GetSnapshot();
		RawState[boids::PreviousGoalTime] = Snapshot.PreviousGoalPhaseTime;
		RawState[boids::GoalAdvance] = Snapshot.GoalPhaseAdvance;
	}

	void FSimulationAbi::PublishFlockMetrics(const FSimulationState& State)
	{
		const FSimulationStateSnapshot& Snapshot = State.GetSnapshot();
		RawState[boids::MeanSpeed] = Snapshot.MeanSpeed;
		RawState[boids::Order] = Snapshot.HeadingAlignment;
		RawState[boids::OutsideCount] = Snapshot.OutsideBirdCount;
		RawState[boids::MaxExcursion] = Snapshot.MaxBoundaryExcursion;
	}

	EBoundaryMode FSimulationAbi::DecodeBoundaryMode(double RawMode)
	{
		if (RawMode == static_cast<double>(EBoundaryMode::Hard))
		{
			return EBoundaryMode::Hard;
		}
		if (RawMode == static_cast<double>(EBoundaryMode::Soft))
		{
			return EBoundaryMode::Soft;
		}
		return EBoundaryMode::Hybrid;
	}

	ESearchMethod FSimulationAbi::DecodeSearchMethod(double RawMethod)
	{
		if (RawMethod == static_cast<double>(ESearchMethod::KdTree))
		{
			return ESearchMethod::KdTree;
		}
		if (RawMethod == static_cast<double>(ESearchMethod::AllPairs))
		{
			return ESearchMethod::AllPairs;
		}
		return ESearchMethod::Grid;
	}

	double* FSimulationAbi::GetConfigAbiData()
	{
		return RawConfig.data();
	}

	const double* FSimulationAbi::GetConfigAbiData() const
	{
		return RawConfig.data();
	}

	double* FSimulationAbi::GetStateAbiData()
	{
		return RawState.data();
	}

	const double* FSimulationAbi::GetStateAbiData() const
	{
		return RawState.data();
	}

	double* FSimulationAbi::GetObstacleRecordsAbiData()
	{
		return RawObstacleRecords.data();
	}

	const double* FSimulationAbi::GetObstacleRecordsAbiData() const
	{
		return RawObstacleRecords.data();
	}
} // namespace boids
