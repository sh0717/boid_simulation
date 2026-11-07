#pragma once
#include "core/WorldBounds.h"

namespace boids
{
	enum class EBoundaryMode : int
	{
		Hard = 0,
		Soft = 1,
		Hybrid = 2
	};

	enum class ESearchMethod : int
	{
		Grid = 0,
		KdTree = 1,
		AllPairs = 2
	};

	// 계산에 필요한 설정 값을 직접 소유하고 경계 모드의 적용 정책을 제공합니다.
	// ABI 숫자 배열과 enum 해석은 FSimulationAbi가 담당합니다.
	class FSimulationConfig
	{
	public:
		/** Soft 모드에서만 위치의 강제 제한을 생략합니다. Hybrid는 강제 제한을 유지합니다. */
		[[nodiscard]] bool IsSoftBoundary() const
		{
			return BoundaryMode == EBoundaryMode::Soft;
		}

		/** Soft·Hybrid 모드에서는 경계 조향 힘을 사용하고 Hard 모드에서는 사용하지 않습니다. */
		[[nodiscard]] bool UsesBoundarySteering() const
		{
			return BoundaryMode != EBoundaryMode::Hard;
		}

		// 군집 규칙과 인지 범위
		int RequestedBirdCount = 0;

		double CohesionWeight = 0;

		double AlignmentWeight = 0;

		double SeparationWeight = 0;

		double PerceptionRadius = 0;

		double FieldOfViewDegrees = 0;

		// 목표와 포식자
		bool bGoalEnabled = false;

		double GoalSpeedMultiplier = 0;

		double GoalAttractionWeight = 0;

		bool bPredatorEnabled = false;

		double PredatorMaxSpeed = 0;

		double PredatorAvoidanceRadius = 0;

		double PredatorAvoidanceWeight = 0;

		// 장애물·경계·탐색 설정
		bool bObstaclesEnabled = false;

		EBoundaryMode BoundaryMode = EBoundaryMode::Hard;

		double BoundaryMargin = 0;

		double BoundaryStrength = 0;

		ESearchMethod SearchMethod = ESearchMethod::Grid;

		FWorldBounds Bounds;

		double CellSize = 0;

		int ObstacleCount = 0;
	};
} // namespace boids
