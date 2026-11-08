#include "simulation/Goal.h"
#include "core/MathUtils.h"

#include <algorithm>
#include <cmath>

using namespace detail;

void FGoal::Update(double GoalTime, const FWorldBounds& Bounds)
{
	double Time = GoalTime;

	// 음수·주기 초과 위상을 경로의 한 주기 안으로 되돌립니다.
	if (Time >= GoalPathPeriod || Time < 0)
	{
		Time = std::fmod(std::fmod(Time, GoalPathPeriod) + GoalPathPeriod, GoalPathPeriod);
	}

	// 삼각함수 결과와 맵 비율 적용 결과를 각각 float32로 저장합니다.
	Position[EAxis::X] = static_cast<float>(std::cos(Time * constants::GoalHorizontalAngularSpeed) * constants::GoalHorizontalRadius);
	Position[EAxis::Y] = static_cast<float>(std::sin(Time * constants::GoalVerticalAngularSpeed) * constants::GoalVerticalAmplitude + constants::GoalVerticalOffset);
	Position[EAxis::Z] = static_cast<float>(std::sin(Time * constants::GoalHorizontalAngularSpeed) * constants::GoalHorizontalRadius);

	for (EAxis Axis : AllAxes)
	{
		Position[Axis] = static_cast<float>(Position[Axis] * std::min(1.0, Bounds.HalfExtents[Axis] / constants::GoalReferenceHalfExtent));
	}
}

void FGoal::AccumulateAttractionForce(const FVector3D& BirdPosition, double AttractionWeight, FVector3D& InOutForce) const
{
	InOutForce += (Position.ToDouble() - BirdPosition) * (constants::GoalAttractionScale * AttractionWeight);
}
