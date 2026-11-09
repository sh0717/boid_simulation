#include "simulation/BirdFlock.h"
#include "core/MathUtils.h"

#include <algorithm>
#include <cmath>
#include <numbers>

using namespace detail;
using namespace constants;

FBirdFlock::FBirdFlock(int RequestedWorkerThreadLimit)
	: Velocities(&VelocityA)
	, NextVelocities(&VelocityB)
	, NeighborCounts(MaxBirdCount, std::uint16_t{0})
	, InspectionNeighborIndices(MaxBirdCount, std::uint16_t{0})
	, Inspection(InspectionValueCount, 0.0)
	, RandomState(0)
	, Search(std::make_unique<FNeighborSearch>())
	, BirdUpdateExecutor(RequestedWorkerThreadLimit)
{
	NearestNeighborScratch.reserve(MaxBirdCount);
}

double FBirdFlock::RandomValue()
{
	// Mulberry32의 비트 상수와 uint32 오버플로 순서를 유지합니다.
	RandomState += 0x6D2B79F5u;
	std::uint32_t RandomBits = (RandomState ^ (RandomState >> 15)) * (1u | RandomState);
	RandomBits ^= RandomBits + (RandomBits ^ (RandomBits >> 7)) * (61u | RandomBits);

	return static_cast<double>(RandomBits ^ (RandomBits >> 14)) / RandomOutputScale;
}

void FBirdFlock::EnforceBirdSpeedRange(FBirdVectorBuffer& Buffer, int BirdIndex)
{
	const FVector3D Velocity = Buffer.GetVector(BirdIndex);
	const double Speed = Velocity.Length();
	if (Speed < Epsilon)
	{
		Buffer.SetVector(BirdIndex, {MinimumBoidSpeed, 0, 0});
		return;
	}

	const double Factor = Clamp(Speed, MinimumBoidSpeed, MaximumBoidSpeed) / Speed;
	const FVector3D LimitedVelocity = Velocity * Factor;
	Buffer.SetVector(BirdIndex, LimitedVelocity);
}

void FBirdFlock::Reset(std::uint32_t Seed, const FFlockContext& Context)
{
	RandomState = Seed;

	// 현재 속도 역할을 유지해야 홀수 스텝 뒤 재시작도 기존 버퍼 계약을 지킵니다.
	for (int BirdIndex = 0; BirdIndex < Context.ActiveBirdCount; ++BirdIndex)
	{
		for (EAxis Axis : AllAxes)
		{
			Positions.GetComponent(BirdIndex, Axis) = static_cast<float>((RandomValue() - 0.5) * (Context.Config.Bounds.HalfExtents[Axis] * 2 - BoidSpawnPadding));
			Velocities->GetComponent(BirdIndex, Axis) = static_cast<float>(RandomValue() * 2 - 1);
		}

		EnforceBirdSpeedRange(*Velocities, BirdIndex);
		if (Context.Config.bObstaclesEnabled)
		{
			ResolveObstacles(Context, BirdIndex);
		}
	}

	std::fill(NeighborCounts.begin(), NeighborCounts.end(), std::uint16_t{0});
}

void FBirdFlock::SnapInterpolation()
{
	PreviousPositions.CopyFrom(Positions);
}

void FBirdFlock::RebuildNeighborSearch(const FFlockContext& Context)
{
	Search->Rebuild(Context.Config.SearchMethod, Positions, Context.ActiveBirdCount, Context.Config.Bounds, Context.Config.CellSize);
}

void FBirdFlock::UpdateBirdInspection(int BirdIndex, const FFlockContext& Context)
{
	RebuildNeighborSearch(Context);
	EvaluateFlocking(Context, CreateNeighborhoodQuery(Context.Config), BirdIndex, true);
}

void FBirdFlock::RefreshNeighborhoodCounts(const FFlockContext& Context)
{
	RebuildNeighborSearch(Context);
	const FNeighborhoodQuery Query = CreateNeighborhoodQuery(Context.Config);

	for (int BirdIndex = 0; BirdIndex < Context.ActiveBirdCount; ++BirdIndex)
	{
		const FFlockingResult Result = EvaluateFlocking(Context, Query, BirdIndex);
		NeighborCounts[BirdIndex] = static_cast<std::uint16_t>(Result.VisibleNeighborCount);
	}
}

double FBirdFlock::IntegrateNextVelocities(double DeltaTimeSeconds, const FFlockContext& Context)
{
	// 거리 제곱과 시야각 기준은 이번 조회의 모든 개체가 공유합니다.
	const FNeighborhoodQuery Query = CreateNeighborhoodQuery(Context.Config);
	double TotalDistanceChecks = 0;

	for (int BirdIndex = 0; BirdIndex < Context.ActiveBirdCount; ++BirdIndex)
	{
		FFlockingResult Result = EvaluateFlocking(Context, Query, BirdIndex);
		TotalDistanceChecks += Result.DistanceCheckCount;
		NeighborCounts[BirdIndex] = static_cast<std::uint16_t>(Result.VisibleNeighborCount);

		AccumulateExternalForces(Context, BirdIndex, Result.Force);
		IntegrateBirdVelocity(BirdIndex, Result.Force, DeltaTimeSeconds);
	}

	// 개체별 결과는 다음 속도에만 썼으며 현재 속도 역할의 교체는 호출자가 별도로 수행합니다.
	return TotalDistanceChecks;
}

void FBirdFlock::AccumulateExternalForces(const FFlockContext& Context, int BirdIndex, FVector3D& InOutForce) const
{
	const FVector3D Position = Positions.GetVector(BirdIndex);

	if (Context.Config.bGoalEnabled)
	{
		Context.Goal.AccumulateAttractionForce(Position, Context.Config.GoalAttractionWeight, InOutForce);
	}

	if (Context.Config.bPredatorEnabled)
	{
		Context.Predator.AccumulateAvoidanceForce(Position, Context.Config.PredatorAvoidanceRadius, Context.Config.PredatorAvoidanceWeight, InOutForce);
	}

	AccumulateObstacleAvoidanceForce(Context, BirdIndex, InOutForce);
	BlendBoundarySteering(Context, BirdIndex, InOutForce);
}

void FBirdFlock::IntegrateBirdVelocity(int BirdIndex, const FVector3D& Force, double DeltaTimeSeconds)
{
	const FVector3D CurrentVelocity = Velocities->GetVector(BirdIndex);
	const double ForceScale = std::min(1.0, MaximumBoidForce / std::max(Epsilon, Force.Length()));
	const FVector3D NextVelocity = CurrentVelocity + Force * ForceScale * DeltaTimeSeconds;

	NextVelocities->SetVector(BirdIndex, NextVelocity);
	EnforceBirdSpeedRange(*NextVelocities, BirdIndex);
}

void FBirdFlock::CommitVelocitiesAndIntegratePositions(double DeltaTimeSeconds, const FFlockContext& Context)
{
	// 모든 개체가 이전 속도를 읽은 뒤 역할을 한 번만 교체합니다.
	std::swap(Velocities, NextVelocities);

	// 각 작업은 자기 구간의 위치·속도만 수정하며, 모든 구간 완료 후 반환합니다.
	const auto IntegrateRange = [this, &Context, DeltaTimeSeconds](int FirstBirdIndex, int EndBirdIndexExclusive) noexcept
	{
		for (int BirdIndex = FirstBirdIndex; BirdIndex < EndBirdIndexExclusive; ++BirdIndex)
		{
			const FVector3D NextPosition = Positions.GetVector(BirdIndex) + Velocities->GetVector(BirdIndex) * DeltaTimeSeconds;
			Positions.SetVector(BirdIndex, NextPosition);

			if (Context.Config.bObstaclesEnabled)
			{
				ResolveObstacles(Context, BirdIndex);
			}

			EnforceBirdBoundsAndSpeed(Context, BirdIndex);
		}
	};

	BirdUpdateExecutor.ExecuteBirdRangesAndWait(Context.ActiveBirdCount, IntegrateRange);
}

FBirdFlockMetrics FBirdFlock::CalculateMetrics(const FFlockContext& Context) const
{
	double SpeedSum = 0;
	FVector3D HeadingSum;
	double OutsideBirdCount = 0;
	double MaxBoundaryExcursion = 0;

	for (int BirdIndex = 0; BirdIndex < Context.ActiveBirdCount; ++BirdIndex)
	{
		const FVector3D Velocity = Velocities->GetVector(BirdIndex);
		const double Speed = std::max(Epsilon, Velocity.Length());
		SpeedSum += Speed;
		double BoundaryExcursion = 0;

		for (EAxis Axis : AllAxes)
		{
			HeadingSum[Axis] += Velocity[Axis] / Speed;
			BoundaryExcursion = std::max(BoundaryExcursion, std::abs(Positions.GetComponent(BirdIndex, Axis)) - Context.Config.Bounds.HalfExtents[Axis]);
		}

		if (BoundaryExcursion > 0)
		{
			++OutsideBirdCount;
		}
		MaxBoundaryExcursion = std::max(MaxBoundaryExcursion, BoundaryExcursion);
	}

	return {SpeedSum / Context.ActiveBirdCount, HeadingSum.Length() / Context.ActiveBirdCount, OutsideBirdCount, MaxBoundaryExcursion};
}

FBirdFlockBuffers FBirdFlock::GetAbiBuffers()
{
	return {Positions.GetAbiData(), PreviousPositions.GetAbiData(), Velocities->GetAbiData(), NextVelocities->GetAbiData(), NeighborCounts.data(), Inspection.data(), InspectionNeighborIndices.data()};
}

int FBirdFlock::GetLastUpdateWorkerCount() const
{
	return BirdUpdateExecutor.GetLastExecutionWorkerCount();
}

const FBirdVectorBuffer& FBirdFlock::GetPositions() const
{
	return Positions;
}

FBirdFlock::FNeighborhoodQuery FBirdFlock::CreateNeighborhoodQuery(const FSimulationConfig& Config)
{
	return {Config.PerceptionRadius, Config.PerceptionRadius * Config.PerceptionRadius, std::cos(Config.FieldOfViewDegrees * std::numbers::pi / FullFieldOfViewDegrees), Config.FieldOfViewDegrees < FullFieldOfViewDegrees, Config.MaximumNeighborCount};
}

FFlockingResult FBirdFlock::EvaluateFlocking(const FFlockContext& Context, const FNeighborhoodQuery& Query, int BirdIndex, bool bWriteInspection)
{
	const FFlockingAccumulator Accumulator = CollectNeighborhood(Query, BirdIndex, bWriteInspection);
	const FFlockingForces Forces = CalculateFlockingForces(Context, BirdIndex, Accumulator);

	FFlockingResult Result;
	Result.Force = (Forces.Separation + Forces.Cohesion) + Forces.Alignment;
	Result.DistanceCheckCount = Accumulator.DistanceCheckCount;
	Result.VisibleNeighborCount = Accumulator.VisibleNeighborCount;

	if (bWriteInspection)
	{
		PublishBirdInspection(Accumulator, Forces);
	}

	return Result;
}

FBirdFlock::FFlockingAccumulator FBirdFlock::CollectNeighborhood(const FNeighborhoodQuery& Query, int BirdIndex, bool bWriteInspection)
{
	const FVector3D Position = Positions.GetVector(BirdIndex);
	const FVector3D Velocity = Velocities->GetVector(BirdIndex);
	const double SpeedSquared = Velocity.LengthSquared();
	const double SeparationRadiusSquared = SeparationRadius * SeparationRadius;
	const bool bFilterFieldOfView = Query.bFilterFieldOfView && SpeedSquared > Epsilon;
	FFlockingAccumulator Accumulator;

	const auto AccumulateSelectedNeighbor = [this, &Accumulator, &Query, &Velocity, BirdIndex, SeparationRadiusSquared, bFilterFieldOfView, SpeedSquared, bWriteInspection](int NeighborBirdIndex, const FVector3D& AwayFromNeighbor, double DistanceSquared)
	{
		// 시야 밖의 근접 개체도 겹침을 피해야 하므로 FOV 판정보다 먼저 분리를 누적합니다.
		if (DistanceSquared < SeparationRadiusSquared)
		{
			++Accumulator.CloseNeighborCount;
			if (DistanceSquared < Epsilon)
			{
				Accumulator.SeparationSum.X += BirdIndex < NeighborBirdIndex ? -1 : 1;
			}
			else
			{
				Accumulator.SeparationSum += AwayFromNeighbor / DistanceSquared;
			}
		}

		// AwayFromNeighbor는 이웃에서 자신으로 향하므로 시선 판정에는 내적의 부호를 뒤집습니다.
		const bool bOutsideFieldOfView = bFilterFieldOfView && DistanceSquared >= Epsilon && -Velocity.Dot(AwayFromNeighbor) < Query.HalfFieldOfViewCosine * std::sqrt(SpeedSquared * DistanceSquared) - FieldOfViewTolerance;
		if (bOutsideFieldOfView)
		{
			return;
		}

		Accumulator.PositionSum += Positions.GetVector(NeighborBirdIndex);
		Accumulator.VelocitySum += Velocities->GetVector(NeighborBirdIndex);
		if (bWriteInspection)
		{
			InspectionNeighborIndices[Accumulator.VisibleNeighborCount] = static_cast<std::uint16_t>(NeighborBirdIndex);
		}
		++Accumulator.VisibleNeighborCount;
	};

	const auto IsNearer = [](const FNearestNeighborCandidate& Left, const FNearestNeighborCandidate& Right)
	{
		return Left.DistanceSquared < Right.DistanceSquared || (Left.DistanceSquared == Right.DistanceSquared && Left.BirdIndex < Right.BirdIndex);
	};

	if (Query.MaximumNeighborCount > 0)
	{
		NearestNeighborScratch.clear();
	}

	const std::vector<int>& CandidateIndices = Search->QueryCandidates(Position, Query.PerceptionRadius);

	for (int NeighborBirdIndex : CandidateIndices)
	{
		if (BirdIndex == NeighborBirdIndex)
		{
			continue;
		}

		++Accumulator.DistanceCheckCount;
		const FVector3D AwayFromNeighbor = Position - Positions.GetVector(NeighborBirdIndex);
		const double DistanceSquared = AwayFromNeighbor.LengthSquared();
		if (DistanceSquared >= Query.PerceptionRadiusSquared)
		{
			continue;
		}

		if (Query.MaximumNeighborCount == 0)
		{
			// 무제한일 때는 기존 후보 순서 그대로 누적하여 수치 동작을 유지합니다.
			AccumulateSelectedNeighbor(NeighborBirdIndex, AwayFromNeighbor, DistanceSquared);
			continue;
		}

		const FNearestNeighborCandidate Candidate = {NeighborBirdIndex, DistanceSquared};
		if (NearestNeighborScratch.size() < static_cast<std::size_t>(Query.MaximumNeighborCount))
		{
			NearestNeighborScratch.push_back(Candidate);
			std::push_heap(NearestNeighborScratch.begin(), NearestNeighborScratch.end(), IsNearer);
		}
		else if (IsNearer(Candidate, NearestNeighborScratch.front()))
		{
			// 최대 힙의 첫 원소가 선택된 후보 중 가장 멀고, 동률이면 번호가 가장 큽니다.
			std::pop_heap(NearestNeighborScratch.begin(), NearestNeighborScratch.end(), IsNearer);
			NearestNeighborScratch.back() = Candidate;
			std::push_heap(NearestNeighborScratch.begin(), NearestNeighborScratch.end(), IsNearer);
		}
	}

	if (Query.MaximumNeighborCount > 0)
	{
		std::sort_heap(NearestNeighborScratch.begin(), NearestNeighborScratch.end(), IsNearer);

		for (const FNearestNeighborCandidate& Candidate : NearestNeighborScratch)
		{
			const FVector3D AwayFromNeighbor = Position - Positions.GetVector(Candidate.BirdIndex);
			AccumulateSelectedNeighbor(Candidate.BirdIndex, AwayFromNeighbor, Candidate.DistanceSquared);
		}
	}

	return Accumulator;
}

FBirdFlock::FFlockingForces FBirdFlock::CalculateFlockingForces(const FFlockContext& Context, int BirdIndex, const FFlockingAccumulator& Accumulator) const
{
	FVector3D CohesionForce = Accumulator.PositionSum;
	FVector3D AlignmentForce = Accumulator.VelocitySum;
	FVector3D SeparationForce = Accumulator.SeparationSum;

	if (Accumulator.VisibleNeighborCount)
	{
		CohesionForce = (CohesionForce / Accumulator.VisibleNeighborCount - Positions.GetVector(BirdIndex)) * (Context.Config.CohesionWeight * CohesionScale);
		AlignmentForce = (AlignmentForce / Accumulator.VisibleNeighborCount - Velocities->GetVector(BirdIndex)) * Context.Config.AlignmentWeight;
	}

	SeparationForce *= Context.Config.SeparationWeight * SeparationScale;

	return {CohesionForce, AlignmentForce, SeparationForce};
}

void FBirdFlock::PublishBirdInspection(const FFlockingAccumulator& Accumulator, const FFlockingForces& Forces)
{
	for (EAxis Axis : AllAxes)
	{
		Inspection[InspectionCohesionOffset + ToIndex(Axis)] = Forces.Cohesion[Axis];
		Inspection[InspectionAlignmentOffset + ToIndex(Axis)] = Forces.Alignment[Axis];
		Inspection[InspectionSeparationOffset + ToIndex(Axis)] = Forces.Separation[Axis];
	}

	Inspection[InspectionNeighborCount] = Accumulator.VisibleNeighborCount;
	Inspection[InspectionCloseCount] = Accumulator.CloseNeighborCount;
}

void FBirdFlock::ResolveObstacles(const FFlockContext& Context, int BirdIndex)
{
	for (int ObstacleIndex = 0; ObstacleIndex < Context.Obstacles.GetActiveObstacleCount(); ++ObstacleIndex)
	{
		const FVector3D Position = Positions.GetVector(BirdIndex);
		FVector3D SurfaceNormal;
		const FObstacle& Obstacle = Context.Obstacles.GetObstacle(ObstacleIndex);
		const double SignedSurfaceDistance = Obstacle.CalculateSignedDistance(Position, SurfaceNormal);

		if (SignedSurfaceDistance >= ObstacleClearance)
		{
			continue;
		}

		const double ProjectionDistance = ObstacleClearance - SignedSurfaceDistance + ObstacleProjectionSlop;
		// 다음 장애물이 이 보정 결과를 읽으므로 장애물별 처리 순서를 유지합니다.
		ProjectBirdOutsideObstacle(Context, BirdIndex, SurfaceNormal, ProjectionDistance);
		ReflectBirdVelocityFromObstacle(BirdIndex, SurfaceNormal);
		EnforceBirdSpeedRange(*Velocities, BirdIndex);
	}
}

void FBirdFlock::ProjectBirdOutsideObstacle(const FFlockContext& Context, int BirdIndex, const FVector3D& SurfaceNormal, double ProjectionDistance)
{
	for (EAxis Axis : AllAxes)
	{
		float& PositionComponent = Positions.GetComponent(BirdIndex, Axis);
		PositionComponent = static_cast<float>(PositionComponent + SurfaceNormal[Axis] * ProjectionDistance);

		if (!Context.Config.IsSoftBoundary())
		{
			PositionComponent = static_cast<float>(Clamp(PositionComponent, -Context.Config.Bounds.HalfExtents[Axis], Context.Config.Bounds.HalfExtents[Axis]));
		}
	}
}

void FBirdFlock::ReflectBirdVelocityFromObstacle(int BirdIndex, const FVector3D& SurfaceNormal)
{
	double NormalVelocity = 0;

	for (EAxis Axis : AllAxes)
	{
		NormalVelocity += Velocities->GetComponent(BirdIndex, Axis) * SurfaceNormal[Axis];
	}

	if (NormalVelocity < 0)
	{
		for (EAxis Axis : AllAxes)
		{
			float& VelocityComponent = Velocities->GetComponent(BirdIndex, Axis);
			VelocityComponent = static_cast<float>(VelocityComponent - ObstacleNormalResponseScale * NormalVelocity * SurfaceNormal[Axis]);
		}
	}
}

void FBirdFlock::ReconcileObstacles(const FFlockContext& Context)
{
	// 장애물은 읽기만 공유합니다. 모든 구간의 보정 완료 후 이전 위치를 복사합니다.
	const auto ReconcileRange = [this, &Context](int FirstBirdIndex, int EndBirdIndexExclusive) noexcept
	{
		for (int BirdIndex = FirstBirdIndex; BirdIndex < EndBirdIndexExclusive; ++BirdIndex)
		{
			ResolveObstacles(Context, BirdIndex);
		}
	};

	BirdUpdateExecutor.ExecuteBirdRangesAndWait(Context.ActiveBirdCount, ReconcileRange);

	PreviousPositions.CopyFrom(Positions);
}

void FBirdFlock::AccumulateObstacleAvoidanceForce(const FFlockContext& Context, int BirdIndex, FVector3D& InOutForce) const
{
	if (!Context.Config.bObstaclesEnabled)
	{
		return;
	}

	for (int ObstacleIndex = 0; ObstacleIndex < Context.Obstacles.GetActiveObstacleCount(); ++ObstacleIndex)
	{
		const FObstacle& Obstacle = Context.Obstacles.GetObstacle(ObstacleIndex);
		const FVector3D LookAheadPosition = Positions.GetVector(BirdIndex) + Velocities->GetVector(BirdIndex) * ObstacleLookAhead;
		FVector3D Normal;
		const double SignedSurfaceDistance = Obstacle.CalculateSignedDistance(LookAheadPosition, Normal);
		if (!(SignedSurfaceDistance < ObstacleAvoidanceDistance))
		{
			continue;
		}

		const double FalloffLength = Obstacle.GetAvoidanceFalloffLength(ObstacleAvoidanceDistance);
		const double ForceMagnitude = std::min(1.0, (ObstacleAvoidanceDistance - SignedSurfaceDistance) / FalloffLength) * ObstacleAvoidanceForceScale;
		InOutForce += Normal * ForceMagnitude;
	}
}

void FBirdFlock::EnforceBirdBoundsAndSpeed(const FFlockContext& Context, int BirdIndex)
{
	if (!Context.Config.IsSoftBoundary())
	{
		for (EAxis Axis : AllAxes)
		{
			float& PositionComponent = Positions.GetComponent(BirdIndex, Axis);
			if (std::abs(PositionComponent) > Context.Config.Bounds.HalfExtents[Axis])
			{
				const double Direction = Sign(PositionComponent);
				PositionComponent = static_cast<float>(Direction * Context.Config.Bounds.HalfExtents[Axis]);
				float& VelocityComponent = Velocities->GetComponent(BirdIndex, Axis);
				VelocityComponent = static_cast<float>(-Direction * std::abs(VelocityComponent));
			}
		}
	}

	EnforceBirdSpeedRange(*Velocities, BirdIndex);
}

FBirdFlock::FBoundarySteering FBirdFlock::CalculateBoundarySteering(const FFlockContext& Context, int BirdIndex) const
{
	FBoundarySteering Steering;
	double NormalizedExcursion = 0;

	for (EAxis Axis : AllAxes)
	{
		const double Position = Positions.GetComponent(BirdIndex, Axis);
		const double MarginWidth = std::min(Context.Config.BoundaryMargin, Context.Config.Bounds.HalfExtents[Axis] * BoundaryMarginFraction);
		Steering.Force[Axis] = -Sign(Position) * std::max(0.0, std::abs(Position) - Context.Config.Bounds.HalfExtents[Axis] + MarginWidth);
		NormalizedExcursion = std::max(NormalizedExcursion, (std::abs(Position) - Context.Config.Bounds.HalfExtents[Axis]) / MarginWidth);
	}

	Steering.OutsideBlendWeight = std::min(1.0, NormalizedExcursion);
	const double Magnitude = Steering.Force.Length();
	if (Magnitude < Epsilon)
	{
		// 매우 작은 힘도 기존 조기 반환값이므로 0으로 덮어쓰지 않습니다.
		return Steering;
	}

	const FVector3D InwardNormal = Steering.Force / Magnitude;
	const FVector3D Velocity = Velocities->GetVector(BirdIndex);
	const double Speed = Velocity.Length();

	double DirectionCosine = 0;
	for (EAxis Axis : AllAxes)
	{
		DirectionCosine += InwardNormal[Axis] * Velocity[Axis];
	}
	DirectionCosine = Speed > Epsilon ? DirectionCosine / Speed : 0;

	const double BoundaryForceMagnitude = Magnitude * BoundaryForceScale * Context.Config.BoundaryStrength;
	Steering.Force = InwardNormal * BoundaryForceMagnitude;

	const double TurnWeight = std::max(0.0, (-DirectionCosine - BoundaryHeadOnCosine) / BoundaryTurnRange);
	if (TurnWeight == 0)
	{
		return Steering;
	}

	AccumulateBoundaryTangentForce(InwardNormal, BoundaryForceMagnitude, TurnWeight, Steering.Force);

	return Steering;
}

EAxis FBirdFlock::SelectBoundaryTangentAxis(const FVector3D& InwardNormal)
{
	// 가장 작은 법선 성분의 축을 택해 정면 접근에서도 안정된 접선 방향을 만듭니다.
	// 동률에서는 기존 X, Y, Z 우선순위를 유지합니다.
	if (std::abs(InwardNormal.X) <= std::abs(InwardNormal.Y) && std::abs(InwardNormal.X) <= std::abs(InwardNormal.Z))
	{
		return EAxis::X;
	}

	if (std::abs(InwardNormal.Y) <= std::abs(InwardNormal.Z))
	{
		return EAxis::Y;
	}

	return EAxis::Z;
}

void FBirdFlock::AccumulateBoundaryTangentForce(const FVector3D& InwardNormal, double BoundaryForceMagnitude, double TurnWeight, FVector3D& InOutForce)
{
	const EAxis TangentAxis = SelectBoundaryTangentAxis(InwardNormal);
	const double TangentScale = BoundaryForceMagnitude * TurnWeight / std::sqrt(std::max(Epsilon, 1 - InwardNormal[TangentAxis] * InwardNormal[TangentAxis]));

	for (EAxis ComponentAxis : AllAxes)
	{
		InOutForce[ComponentAxis] += ((TangentAxis == ComponentAxis ? 1 : 0) - InwardNormal[ComponentAxis] * InwardNormal[TangentAxis]) * TangentScale;
	}
}

void FBirdFlock::ReconcileBounds(const FFlockContext& Context)
{
	// 서로 다른 개체는 독립이며, 한 개체의 경계 → 장애물 → 경계 보정 순서는 유지합니다.
	const auto ReconcileRange = [this, &Context](int FirstBirdIndex, int EndBirdIndexExclusive) noexcept
	{
		for (int BirdIndex = FirstBirdIndex; BirdIndex < EndBirdIndexExclusive; ++BirdIndex)
		{
			EnforceBirdBoundsAndSpeed(Context, BirdIndex);

			if (Context.Config.bObstaclesEnabled)
			{
				ResolveObstacles(Context, BirdIndex);
			}

			EnforceBirdBoundsAndSpeed(Context, BirdIndex);
		}
	};

	BirdUpdateExecutor.ExecuteBirdRangesAndWait(Context.ActiveBirdCount, ReconcileRange);
}

void FBirdFlock::BlendBoundarySteering(const FFlockContext& Context, int BirdIndex, FVector3D& InOutForce) const
{
	if (Context.Config.UsesBoundarySteering())
	{
		const FBoundarySteering Steering = CalculateBoundarySteering(Context, BirdIndex);
		InOutForce = InOutForce * (1 - Steering.OutsideBlendWeight) + Steering.Force;
	}
}
