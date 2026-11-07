#include "Simulation.h"
#include <boids/boids.h>

namespace
{
	FSimulation Simulation;
}

// ABI 경계: 공개 C 함수는 검증된 입력을 FSimulation의 작업으로 전달합니다.
// 함수별 계약은 공개 boids.h에 있으며 수치 상태와 반환 버퍼는 Simulation이 소유합니다.
extern "C"
{
	BOIDS_API int boids_abi_version()
	{
		return 1;
	}

	BOIDS_API std::uint32_t boids_abi_schema()
	{
		// 대여 뷰 생성 전에 호스트와 코어의 슬롯·원소 크기·용량 불일치를 검출합니다.
		const int Words[] = {1, Capacity, MaxObstacles, ConfigSize, StateSize, constants::ObstacleStride, constants::InspectionValueCount, Count, Cohesion, Alignment, Separation, Perception, FieldOfView, GoalEnabled, GoalSpeed, GoalStrength, PredatorEnabled, PredatorSpeed, PredatorRadius, PredatorStrength, ObstaclesEnabled, BoundaryMode, BoundaryMargin, BoundaryStrength, SearchType, HalfX, HalfY, HalfZ, CellSize, ObstacleCount, ActiveCount, Time, GoalTime, PreviousGoalTime, GoalAdvance, NeighborChecks, MeanSpeed, Order, OutsideCount, MaxExcursion, static_cast<int>(ECoreBuffer::Config), static_cast<int>(ECoreBuffer::State), static_cast<int>(ECoreBuffer::Positions), static_cast<int>(ECoreBuffer::PreviousPositions), static_cast<int>(ECoreBuffer::Velocities), static_cast<int>(ECoreBuffer::NextVelocities), static_cast<int>(ECoreBuffer::NeighborCounts), static_cast<int>(ECoreBuffer::Goal), static_cast<int>(ECoreBuffer::Predator), static_cast<int>(ECoreBuffer::PreviousPredator), static_cast<int>(ECoreBuffer::PredatorVelocity), static_cast<int>(ECoreBuffer::Obstacles), static_cast<int>(ECoreBuffer::Inspection), static_cast<int>(ECoreBuffer::Neighbors), sizeof(double), ConfigSize, sizeof(double), StateSize, sizeof(float), constants::BirdVectorComponentCount, sizeof(float), constants::BirdVectorComponentCount, sizeof(float), constants::BirdVectorComponentCount, sizeof(float), constants::BirdVectorComponentCount, sizeof(std::uint16_t), Capacity, sizeof(float), constants::AxisCount, sizeof(float), constants::AxisCount, sizeof(float), constants::AxisCount, sizeof(float), constants::AxisCount, sizeof(double), MaxObstacles * constants::ObstacleStride, sizeof(double), constants::InspectionValueCount, sizeof(std::uint16_t), Capacity, constants::ObstacleTypeOffset, constants::ObstaclePositionOffset, constants::ObstaclePositionOffset + 1, constants::ObstaclePositionOffset + 2, constants::ObstacleRadiusOffset, constants::ObstacleDimensionsOffset, constants::ObstacleDimensionsOffset + 1, constants::ObstacleDimensionsOffset + 2, constants::InspectionNeighborCount, constants::InspectionCloseCount, constants::InspectionCohesionOffset, constants::InspectionAlignmentOffset, constants::InspectionSeparationOffset};
		std::uint32_t Hash = UINT32_C(2166136261);
		for (int Word : Words)
		{
			Hash = (Hash ^ static_cast<std::uint32_t>(Word)) * UINT32_C(16777619);
		}
		return Hash;
	}

	BOIDS_API void* boids_buffer(int Selector)
	{
		return Simulation.GetAbiBuffer(Selector);
	}

	BOIDS_API void boids_set_max_neighbors(int MaximumNeighborCount)
	{
		Simulation.SetMaximumNeighborCount(MaximumNeighborCount);
	}

	BOIDS_API int boids_get_worker_thread_count()
	{
		return Simulation.GetLastUpdateWorkerCount();
	}

	BOIDS_API void boids_reset(std::uint32_t Seed)
	{
		Simulation.Reset(Seed);
	}

	BOIDS_API void boids_step(double DeltaTime)
	{
		Simulation.Step(DeltaTime);
	}

	BOIDS_API void boids_goal()
	{
		Simulation.UpdateGoal();
	}

	BOIDS_API void boids_snap()
	{
		Simulation.SnapInterpolation();
	}

	BOIDS_API void boids_measure()
	{
		Simulation.UpdateFlockMetrics();
	}

	BOIDS_API void boids_rebuild()
	{
		Simulation.RebuildNeighborSearch();
	}

	BOIDS_API void boids_predator(double DeltaTime)
	{
		Simulation.UpdatePredator(DeltaTime);
	}

	BOIDS_API void boids_reconcile_obstacles()
	{
		Simulation.ReconcileObstacles();
	}

	BOIDS_API void boids_reconcile_bounds()
	{
		Simulation.ReconcileBounds();
	}

	BOIDS_API void boids_inspect(int Index)
	{
		Simulation.UpdateBirdInspection(Index);
	}

	BOIDS_API void boids_refresh_neighbors()
	{
		Simulation.RefreshNeighborhoodCounts();
	}
}
