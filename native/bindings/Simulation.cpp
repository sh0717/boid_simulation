#include "Simulation.h"

int FSimulation::GetActiveBirdCount() const
{
	return static_cast<int>(State.GetSnapshot().ActiveBirdCount);
}

void FSimulation::RefreshInputsFromAbi()
{
	Config = Abi.ReadConfigSnapshot();
	State = Abi.ReadStateSnapshot();
	Obstacles.Synchronize(Abi.ReadObstacleSnapshot(Config.ObstacleCount));
}

FFlockContext FSimulation::CreateFlockContext() const
{
	return {Config, Obstacles, GetActiveBirdCount(), Goal, Predator};
}

void* FSimulation::GetAbiBuffer(int Selector)
{
	switch (static_cast<ECoreBuffer>(Selector))
	{
		case ECoreBuffer::Config:
			return Abi.GetConfigAbiData();
		case ECoreBuffer::State:
			return Abi.GetStateAbiData();
		case ECoreBuffer::Positions:
			return Birds.GetAbiBuffers().Positions;
		case ECoreBuffer::PreviousPositions:
			return Birds.GetAbiBuffers().PreviousPositions;
		case ECoreBuffer::Velocities:
			return Birds.GetAbiBuffers().Velocities;
		case ECoreBuffer::NextVelocities:
			return Birds.GetAbiBuffers().NextVelocities;
		case ECoreBuffer::NeighborCounts:
			return Birds.GetAbiBuffers().NeighborCounts;
		case ECoreBuffer::Goal:
			return Goal.GetPositionAbiData();
		case ECoreBuffer::Predator:
			return Predator.GetPositionAbiData();
		case ECoreBuffer::PreviousPredator:
			return Predator.GetPreviousPositionAbiData();
		case ECoreBuffer::PredatorVelocity:
			return Predator.GetVelocityAbiData();
		case ECoreBuffer::Obstacles:
			return Abi.GetObstacleRecordsAbiData();
		case ECoreBuffer::Inspection:
			return Birds.GetAbiBuffers().Inspection;
		case ECoreBuffer::Neighbors:
			return Birds.GetAbiBuffers().InspectionNeighborIndices;
		default:
			return nullptr;
	}
}

void FSimulation::SetMaximumNeighborCount(int MaximumNeighborCount)
{
	Abi.SetMaximumNeighborCount(MaximumNeighborCount);
}

int FSimulation::GetLastUpdateWorkerCount() const
{
	return Birds.GetLastUpdateWorkerCount();
}

void FSimulation::Reset(std::uint32_t Seed)
{
	RefreshInputsFromAbi();
	State.ResetForBirdCount(Config.RequestedBirdCount);
	Birds.Reset(Seed, CreateFlockContext());
	Predator.Reset(Config.Bounds, Config.PredatorMaxSpeed);
	SnapInterpolationState();
	UpdateGoalFromCurrentState();
	WriteFlockMetrics();
	Abi.PublishResetState(State);
}

void FSimulation::Step(double DeltaTime)
{
	// 외부에서 검증한 ABI 입력을 설정·상태 스냅샷과 장애물 객체에 반영합니다.
	// 이후 내부 단계는 이 입력을 사용하며 ABI 상태를 다시 읽지 않습니다.
	RefreshInputsFromAbi();

	// 이동 전 위치를 보관하여 렌더링에서 이전·현재 위치를 보간할 수 있게 합니다.
	Birds.SnapInterpolation();
	// 시뮬레이션 시간과 목표 위상을 진행한 뒤 목표·포식자를 먼저 갱신합니다.
	// 포식자는 이동 전 군집 위치를 읽고, 군집은 갱신된 목표·포식자 위치를 사용합니다.
	State.AdvanceTime(DeltaTime, Config.bGoalEnabled, Config.GoalSpeedMultiplier);
	UpdateGoalFromCurrentState();
	UpdatePredatorFromCurrentState(DeltaTime);

	// 설정·장애물·actor를 호출 동안 빌리는 문맥을 만들고 현재 위치로 탐색을 재구축합니다.
	const FFlockContext Context = CreateFlockContext();
	Birds.RebuildNeighborSearch(Context);

	// 모든 개체가 현재 속도를 읽고 NextVelocities에만 써서 갱신 순서 의존성을 피합니다.
	const double NeighborDistanceChecks = Birds.IntegrateNextVelocities(DeltaTime, Context);

	// 다음 속도 계산이 모두 끝나면 속도 버퍼 역할을 교체하고 새 속도로 위치를 적분합니다.
	// 이어서 장애물 침투·속도 반사와 경계·속력 보정을 적용합니다.
	Birds.CommitVelocitiesAndIntegratePositions(DeltaTime, Context);

	// 군집 갱신이 끝난 뒤 이번 스텝의 거리 검사 횟수를 상태에 기록합니다.
	State.RecordNeighborDistanceChecks(NeighborDistanceChecks);
	// 이동 후 군집 통계를 계산하고 시간·검사 횟수·통계를 ABI 상태 버퍼에 발행합니다.
	// 위치·속도는 군집 소유 버퍼에 이미 기록되어 있으므로 여기서 다시 복사하지 않습니다.
	WriteFlockMetrics();
	Abi.PublishStepState(State);
}

void FSimulation::UpdateGoal()
{
	RefreshInputsFromAbi();
	UpdateGoalFromCurrentState();
}

void FSimulation::UpdateGoalFromCurrentState()
{
	Goal.Update(State.GetSnapshot().GoalPhaseTime, Config.Bounds);
}

void FSimulation::UpdatePredator(double DeltaTime)
{
	RefreshInputsFromAbi();
	UpdatePredatorFromCurrentState(DeltaTime);
}

void FSimulation::UpdatePredatorFromCurrentState(double DeltaTime)
{
	Predator.Update(DeltaTime, Birds.GetPositions(), GetActiveBirdCount(), Config.Bounds, Config.bPredatorEnabled, Config.PredatorMaxSpeed, Config.IsSoftBoundary());
}

void FSimulation::SnapInterpolation()
{
	RefreshInputsFromAbi();
	SnapInterpolationState();
	Abi.PublishGoalInterpolationState(State);
}

void FSimulation::SnapInterpolationState()
{
	Birds.SnapInterpolation();
	Predator.SnapInterpolation();
	State.SnapGoalInterpolation();
}

void FSimulation::UpdateFlockMetrics()
{
	RefreshInputsFromAbi();
	WriteFlockMetrics();
	Abi.PublishFlockMetrics(State);
}

void FSimulation::WriteFlockMetrics()
{
	const FBirdFlockMetrics Metrics = Birds.CalculateMetrics(CreateFlockContext());
	State.SetFlockMetrics(Metrics.MeanSpeed, Metrics.HeadingAlignment, Metrics.OutsideBirdCount, Metrics.MaxBoundaryExcursion);
}

void FSimulation::RebuildNeighborSearch()
{
	RefreshInputsFromAbi();
	Birds.RebuildNeighborSearch(CreateFlockContext());
}

void FSimulation::UpdateBirdInspection(int BirdIndex)
{
	RefreshInputsFromAbi();
	Birds.UpdateBirdInspection(BirdIndex, CreateFlockContext());
}

void FSimulation::RefreshNeighborhoodCounts()
{
	RefreshInputsFromAbi();
	Birds.RefreshNeighborhoodCounts(CreateFlockContext());
}

void FSimulation::ReconcileObstacles()
{
	RefreshInputsFromAbi();
	if (!Config.bObstaclesEnabled)
	{
		return;
	}
	Birds.ReconcileObstacles(CreateFlockContext());
	WriteFlockMetrics();
	Abi.PublishFlockMetrics(State);
}

void FSimulation::ReconcileBounds()
{
	RefreshInputsFromAbi();
	if (Config.IsSoftBoundary())
	{
		return;
	}
	Birds.ReconcileBounds(CreateFlockContext());
	Predator.ReconcileBounds(Config.Bounds);
}
