#include "simulation/Predator.h"
#include "core/MathUtils.h"
#include <algorithm>
#include <cassert>
#include <cmath>

using namespace detail;

void FPredator::Reset(const FWorldBounds& Bounds, double MaxSpeed)
{
	Position[EAxis::X] = static_cast<float>(constants::PredatorSpawnXRatio * Bounds.HalfExtents[EAxis::X]);
	Position[EAxis::Y] = static_cast<float>(constants::PredatorSpawnYRatio * Bounds.HalfExtents[EAxis::Y]);
	Position[EAxis::Z] = static_cast<float>(constants::PredatorSpawnZRatio * Bounds.HalfExtents[EAxis::Z]);
	const double SpawnVelocityScale = std::min(1.0, MaxSpeed / constants::PredatorSpawnReferenceSpeed);
	Velocity[EAxis::X] = static_cast<float>(constants::PredatorInitialVelocityX * SpawnVelocityScale);
	Velocity[EAxis::Y] = 0;
	Velocity[EAxis::Z] = static_cast<float>(constants::PredatorInitialVelocityZ * SpawnVelocityScale);
}

void FPredator::Update(double DeltaTimeSeconds, const FBirdVectorBuffer& BirdPositions, int ActiveBirdCount, const FWorldBounds& Bounds, bool bEnabled, double MaxSpeed, bool bSoftBoundary)
{
	std::copy_n(Position.GetData(), constants::AxisCount, PreviousPosition.GetData());
	if (!bEnabled)
	{
		return;
	}
	// 정지 설정에서도 이전 위치는 이미 갱신했으며 잔여 속도만 제거합니다.
	if (MaxSpeed == 0)
	{
		std::fill_n(Velocity.GetData(), constants::AxisCount, 0.0f);
		return;
	}

	const FVector3D Acceleration = CalculatePursuitAcceleration(BirdPositions, ActiveBirdCount, Bounds, MaxSpeed);
	IntegrateAcceleration(DeltaTimeSeconds, Acceleration);
	LimitSpeedAndIntegratePosition(DeltaTimeSeconds, Bounds, MaxSpeed, bSoftBoundary);
}

FVector3D FPredator::CalculatePursuitAcceleration(const FBirdVectorBuffer& BirdPositions, int ActiveBirdCount, const FWorldBounds& Bounds, double MaxSpeed) const
{
	assert(ActiveBirdCount > 0 && ActiveBirdCount <= BirdPositions.GetBirdCapacity());
	FVector3D BirdPositionSum;
	FVector3D TargetOffset;
	for (int BirdIndex = 0; BirdIndex < ActiveBirdCount; ++BirdIndex)
	{
		for (EAxis Axis : AllAxes)
		{
			BirdPositionSum[Axis] += BirdPositions.GetComponent(BirdIndex, Axis);
		}
	}
	for (EAxis Axis : AllAxes)
	{
		const double MeanBirdPosition = BirdPositionSum[Axis] / ActiveBirdCount;
		const double ClampedTargetPosition = Clamp(MeanBirdPosition, -Bounds.HalfExtents[Axis] + constants::PredatorCenterInset, Bounds.HalfExtents[Axis] - constants::PredatorCenterInset);
		TargetOffset[Axis] = ClampedTargetPosition - Position[Axis];
	}
	const double TargetDistance = std::max(Epsilon, TargetOffset.Length());
	const double DesiredVelocityScale = std::min(1.0, MaxSpeed / TargetDistance);
	return (TargetOffset * DesiredVelocityScale - Velocity.ToDouble()) * constants::PredatorPursuitGain;
}

void FPredator::IntegrateAcceleration(double DeltaTimeSeconds, const FVector3D& Acceleration)
{
	// 가속도의 방향은 유지하고 크기만 최대 가속도 이하로 제한합니다.
	const double AccelerationMagnitude = Acceleration.Length();
	const double AccelerationScale = std::min(1.0, constants::PredatorMaximumAcceleration / std::max(Epsilon, AccelerationMagnitude));
	for (EAxis Axis : AllAxes)
	{
		const double VelocityChange = Acceleration[Axis] * AccelerationScale * DeltaTimeSeconds;
		Velocity[Axis] = static_cast<float>(Velocity[Axis] + VelocityChange);
	}
}

void FPredator::LimitSpeedAndIntegratePosition(double DeltaTimeSeconds, const FWorldBounds& Bounds, double MaxSpeed, bool bSoftBoundary)
{
	const double CurrentSpeed = Velocity.ToDouble().Length();
	const double SpeedLimitScale = std::min(1.0, MaxSpeed / std::max(Epsilon, CurrentSpeed));
	// 축별 속도 반올림 직후 위치를 적분해야 기존 float 저장 순서가 유지됩니다.
	for (EAxis Axis : AllAxes)
	{
		float& VelocityComponent = Velocity[Axis];
		float& PositionComponent = Position[Axis];
		VelocityComponent = static_cast<float>(VelocityComponent * SpeedLimitScale);
		const double PositionLimit = Bounds.HalfExtents[Axis] - constants::PredatorCenterInset;
		const double NextPosition = PositionComponent + VelocityComponent * DeltaTimeSeconds;

		// Soft 경계에서는 위치를 제한하거나 벽 방향 속도를 제거하지 않습니다.
		if (bSoftBoundary)
		{
			PositionComponent = static_cast<float>(NextPosition);
			continue;
		}

		PositionComponent = static_cast<float>(Clamp(NextPosition, -PositionLimit, PositionLimit));
		// 보정 전 위치로 접촉을 판정하고, 경계 밖으로 향하는 축의 속도만 제거합니다.
		const bool bAtOrBeyondBoundary = std::abs(NextPosition) >= PositionLimit;
		const bool bMovingOutward = NextPosition * VelocityComponent > 0;
		if (bAtOrBeyondBoundary && bMovingOutward)
		{
			VelocityComponent = 0;
		}
	}
}

void FPredator::SnapInterpolation()
{
	std::copy_n(Position.GetData(), constants::AxisCount, PreviousPosition.GetData());
}

void FPredator::ReconcileBounds(const FWorldBounds& Bounds)
{
	for (EAxis Axis : AllAxes)
	{
		const double PositionLimit = Bounds.HalfExtents[Axis] - constants::PredatorCenterInset;
		Position[Axis] = static_cast<float>(Clamp(Position[Axis], -PositionLimit, PositionLimit));
		if (std::abs(Position[Axis]) >= PositionLimit && Position[Axis] * Velocity[Axis] > 0)
		{
			Velocity[Axis] = 0;
		}
	}
}

void FPredator::AccumulateAvoidanceForce(const FVector3D& BirdPosition, double AvoidanceRadius, double AvoidanceWeight, FVector3D& InOutForce) const
{
	const FVector3D AwayFromPredator = BirdPosition - Position.ToDouble();
	const double Distance = AwayFromPredator.Length();
	if (Distance < AvoidanceRadius)
	{
		const double ForceStrength = constants::PredatorAvoidanceScale * AvoidanceWeight;
		// 회피 반경의 바깥쪽에 가까워질수록 힘을 줄이고, 나눗셈의 최소 거리를 보장합니다.
		const double DistanceFalloff = 1 - Distance / AvoidanceRadius;
		const double SafeDistance = std::max(Distance, constants::PredatorMinimumAvoidanceDistance);
		const double DistanceFalloffScale = DistanceFalloff * ForceStrength / SafeDistance;

		// 근접 시 +X를 대체 방향으로 사용합니다. 0 나눗셈은 위의 SafeDistance로 방지합니다.
		if (Distance < Epsilon)
		{
			InOutForce[EAxis::X] += ForceStrength;
		}
		else
		{
			InOutForce[EAxis::X] += AwayFromPredator[EAxis::X] * DistanceFalloffScale;
		}
		InOutForce[EAxis::Y] += AwayFromPredator[EAxis::Y] * DistanceFalloffScale;
		InOutForce[EAxis::Z] += AwayFromPredator[EAxis::Z] * DistanceFalloffScale;
	}
}
