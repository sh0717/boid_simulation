#include "SimulationAbi.h"

#include <cassert>

FSimulationConfig FSimulationAbi::ReadConfigSnapshot() const
{
	// 슬롯 해석만 담당합니다. 값의 유한성·범위 검증은 호스트 어댑터에서 끝나 있어야 합니다.
	FSimulationConfig Config;
	Config.RequestedBirdCount = static_cast<int>(RawConfig[Count]);
	Config.MaximumNeighborCount = MaximumNeighborCount;

	Config.CohesionWeight = RawConfig[Cohesion];
	Config.AlignmentWeight = RawConfig[Alignment];
	Config.SeparationWeight = RawConfig[Separation];
	Config.PerceptionRadius = RawConfig[Perception];
	Config.FieldOfViewDegrees = RawConfig[FieldOfView];

	Config.bGoalEnabled = RawConfig[GoalEnabled] != 0;
	Config.GoalSpeedMultiplier = RawConfig[GoalSpeed];
	Config.GoalAttractionWeight = RawConfig[GoalStrength];

	Config.bPredatorEnabled = RawConfig[PredatorEnabled] != 0;
	Config.PredatorMaxSpeed = RawConfig[PredatorSpeed];
	Config.PredatorAvoidanceRadius = RawConfig[PredatorRadius];
	Config.PredatorAvoidanceWeight = RawConfig[PredatorStrength];

	Config.bObstaclesEnabled = RawConfig[ObstaclesEnabled] != 0;
	Config.BoundaryMode = DecodeBoundaryMode(RawConfig[BoundaryMode]);
	Config.BoundaryMargin = RawConfig[BoundaryMargin];
	Config.BoundaryStrength = RawConfig[BoundaryStrength];

	Config.SearchMethod = DecodeSearchMethod(RawConfig[SearchType]);
	Config.Bounds.HalfExtents = {RawConfig[HalfX], RawConfig[HalfY], RawConfig[HalfZ]};
	Config.CellSize = RawConfig[CellSize];
	Config.ObstacleCount = static_cast<int>(RawConfig[ObstacleCount]);

	return Config;
}

void FSimulationAbi::SetMaximumNeighborCount(int RequestedMaximumNeighborCount)
{
	assert(RequestedMaximumNeighborCount >= 0 && RequestedMaximumNeighborCount < constants::MaxBirdCount);

	MaximumNeighborCount = RequestedMaximumNeighborCount;
}

FSimulationState FSimulationAbi::ReadStateSnapshot() const
{
	FSimulationStateSnapshot Snapshot;
	Snapshot.ActiveBirdCount = RawState[ActiveCount];
	Snapshot.SimulationTime = RawState[Time];
	Snapshot.GoalPhaseTime = RawState[GoalTime];
	Snapshot.PreviousGoalPhaseTime = RawState[PreviousGoalTime];
	Snapshot.GoalPhaseAdvance = RawState[GoalAdvance];

	Snapshot.NeighborDistanceChecks = RawState[NeighborChecks];
	Snapshot.MeanSpeed = RawState[MeanSpeed];
	Snapshot.HeadingAlignment = RawState[Order];
	Snapshot.OutsideBirdCount = RawState[OutsideCount];
	Snapshot.MaxBoundaryExcursion = RawState[MaxExcursion];

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
	RawState[ActiveCount] = State.GetSnapshot().ActiveBirdCount;
	PublishStepState(State);
}

void FSimulationAbi::PublishStepState(const FSimulationState& State)
{
	const FSimulationStateSnapshot& Snapshot = State.GetSnapshot();

	// Step은 활성 수를 덮어쓰지 않습니다. 활성 수 변경은 Reset의 발행 계약입니다.
	RawState[Time] = Snapshot.SimulationTime;
	RawState[GoalTime] = Snapshot.GoalPhaseTime;
	PublishGoalInterpolationState(State);

	RawState[NeighborChecks] = Snapshot.NeighborDistanceChecks;
	PublishFlockMetrics(State);
}

void FSimulationAbi::PublishGoalInterpolationState(const FSimulationState& State)
{
	const FSimulationStateSnapshot& Snapshot = State.GetSnapshot();
	RawState[PreviousGoalTime] = Snapshot.PreviousGoalPhaseTime;
	RawState[GoalAdvance] = Snapshot.GoalPhaseAdvance;
}

void FSimulationAbi::PublishFlockMetrics(const FSimulationState& State)
{
	const FSimulationStateSnapshot& Snapshot = State.GetSnapshot();
	RawState[MeanSpeed] = Snapshot.MeanSpeed;
	RawState[Order] = Snapshot.HeadingAlignment;
	RawState[OutsideCount] = Snapshot.OutsideBirdCount;
	RawState[MaxExcursion] = Snapshot.MaxBoundaryExcursion;
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
