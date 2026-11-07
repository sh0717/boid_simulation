#include "simulation/BirdFlock.h"
#include "simulation/BirdUpdateExecutor.h"
#include <algorithm>
#include <array>
#include <atomic>
#include <cstring>
#include <iostream>
#include <set>
#include <thread>
#include <vector>

namespace
{
	bool ExecutorCoverageAndReuse()
	{
		using namespace boids;
		FBirdUpdateExecutor Executor;
		std::set<std::thread::id> FirstTeam;
		const std::array<int, 8> Counts = {0, 1, 255, 256, 257, 1200, 17, 1200};
		for (int Repeat = 0; Repeat < 8; ++Repeat)
		{
			for (int Count : Counts)
			{
				std::vector<std::atomic<int>> Visits(constants::MaxBirdCount);
				std::vector<std::thread::id> ThreadIds(constants::MaxBirdCount);
				std::atomic<int> RangeCalls{0};
				Executor.ForEachRange(Count, [&](int FirstBirdIndex, int LastBirdIndex)
				{
					RangeCalls.fetch_add(1);
					for (int BirdIndex = FirstBirdIndex; BirdIndex < LastBirdIndex; ++BirdIndex)
					{
						if (Visits[BirdIndex].fetch_add(1) == 0)
						{
							ThreadIds[BirdIndex] = std::this_thread::get_id();
						}
					}
				});
				for (int BirdIndex = 0; BirdIndex < constants::MaxBirdCount; ++BirdIndex)
				{
					if (Visits[BirdIndex].load() != (BirdIndex < Count ? 1 : 0))
					{
						return false;
					}
				}
				if (Count == 0)
				{
					if (RangeCalls.load() != 0)
					{
						return false;
					}
					continue;
				}
				const std::set<std::thread::id> Team(ThreadIds.begin(), ThreadIds.begin() + Count);
				if (Count < constants::MinimumParallelBirdCount)
				{
					if (Team.size() != 1 || *Team.begin() != std::this_thread::get_id())
					{
						return false;
					}
				}
				else
				{
					if (std::thread::hardware_concurrency() > 1 && Team.size() < 2)
					{
						return false;
					}
					if (FirstTeam.empty())
					{
						FirstTeam = Team;
					}
					else if (FirstTeam != Team)
					{
						return false;
					}
				}
			}
		}
		std::cout << "PASS: exact range coverage, completion, serial cutoff and " << FirstTeam.size() << " reused execution threads\n";
		return true;
	}

	bool ExecutorIsolationAndShutdown()
	{
		for (int Repeat = 0; Repeat < 8; ++Repeat)
		{
			std::array<int, 1200> First{};
			std::array<int, 1200> Second{};
			std::thread FirstCaller([&]
			{
				boids::FBirdUpdateExecutor Executor;
				Executor.ForEachRange(1200, [&](int Begin, int End)
				{
					std::fill(First.begin() + Begin, First.begin() + End, 7);
				});
			});
			std::thread SecondCaller([&]
			{
				boids::FBirdUpdateExecutor Executor;
				Executor.ForEachRange(1200, [&](int Begin, int End)
				{
					std::fill(Second.begin() + Begin, Second.begin() + End, 11);
				});
			});
			FirstCaller.join();
			SecondCaller.join();
			if (!std::all_of(First.begin(), First.end(),
					[](int Value)
			{
				return Value == 7;
			}) ||
				!std::all_of(Second.begin(), Second.end(), [](int Value)
			{
				return Value == 11;
			}))
			{
				return false;
			}
		}
		return true;
	}

	bool SameBuffers(boids::FBirdFlock& First, boids::FBirdFlock& Second)
	{
		using namespace boids;
		const FBirdFlockBuffers A = First.GetAbiBuffers();
		const FBirdFlockBuffers B = Second.GetAbiBuffers();
		const std::size_t VectorBytes = constants::BirdVectorComponentCount * sizeof(float);
		const std::size_t IndexBytes = constants::MaxBirdCount * sizeof(std::uint16_t);
		return std::memcmp(A.Positions, B.Positions, VectorBytes) == 0 && std::memcmp(A.PreviousPositions, B.PreviousPositions, VectorBytes) == 0 && std::memcmp(A.Velocities, B.Velocities, VectorBytes) == 0 && std::memcmp(A.NextVelocities, B.NextVelocities, VectorBytes) == 0 && std::memcmp(A.NeighborCounts, B.NeighborCounts, IndexBytes) == 0 && std::memcmp(A.InspectionNeighborIndices, B.InspectionNeighborIndices, IndexBytes) == 0 && std::memcmp(A.Inspection, B.Inspection, constants::InspectionValueCount * sizeof(double)) == 0;
	}

	void PlaceContactCases(boids::FBirdFlock& Flock, int Count)
	{
		// 구 중심·상자 중심·월드 밖·경계 근처에 배치하여 실제 접촉 분기를 통과시킵니다.
		const std::array<std::array<float, 3>, 4> Positions = {{{0, 0, 0}, {10, 0, 0}, {30, -30, 30}, {24.9f, 24.9f, -24.9f}}};
		const boids::FBirdFlockBuffers Buffers = Flock.GetAbiBuffers();
		for (int BirdIndex = 0; BirdIndex < Count; ++BirdIndex)
		{
			std::copy(Positions[BirdIndex % Positions.size()].begin(), Positions[BirdIndex % Positions.size()].end(), Buffers.Positions + BirdIndex * 3);
			Buffers.Velocities[BirdIndex * 3] = 4;
			Buffers.Velocities[BirdIndex * 3 + 1] = -3;
			Buffers.Velocities[BirdIndex * 3 + 2] = 2;
		}
	}

	bool FlockScenario(int Count, boids::EBoundaryMode BoundaryMode, boids::ESearchMethod SearchMethod, bool bObstaclesEnabled)
	{
		using namespace boids;
		FSimulationConfig Config;
		Config.RequestedBirdCount = Count;
		Config.Bounds = {{25, 25, 25}};
		Config.BoundaryMode = BoundaryMode;
		Config.BoundaryMargin = 5;
		Config.BoundaryStrength = 1;
		Config.SearchMethod = SearchMethod;
		Config.CellSize = 10;
		Config.PerceptionRadius = 10;
		Config.FieldOfViewDegrees = 270;
		Config.CohesionWeight = 0.85;
		Config.AlignmentWeight = 1.2;
		Config.SeparationWeight = 1.65;
		Config.bGoalEnabled = true;
		Config.GoalAttractionWeight = 1;
		Config.bPredatorEnabled = true;
		Config.PredatorAvoidanceRadius = 13;
		Config.PredatorAvoidanceWeight = 1;
		Config.bObstaclesEnabled = bObstaclesEnabled;
		FObstacleDescriptorSnapshot Snapshot;
		Snapshot.ActiveObstacleCount = bObstaclesEnabled ? 2 : 0;
		Snapshot.Descriptors[0] = {EObstacleShape::Sphere, {0, 0, 0}, 4.5, {}};
		Snapshot.Descriptors[1] = {EObstacleShape::Box, {10, 0, 0}, 0, {6, 8, 10}};
		FObstacleSet Obstacles;
		Obstacles.Synchronize(Snapshot);
		FGoal Goal;
		Goal.Update(0, Config.Bounds);
		FPredator Predator;
		Predator.Reset(Config.Bounds, 14);
		const FFlockContext Context = {Config, Obstacles, Count, Goal, Predator};
		FBirdFlock Serial(0);
		FBirdFlock Parallel;
		Serial.Reset(22823, Context);
		Parallel.Reset(22823, Context);
		PlaceContactCases(Serial, Count);
		PlaceContactCases(Parallel, Count);
		const FBirdFlockBuffers Original = Parallel.GetAbiBuffers();
		for (int Step = 0; Step < 3; ++Step)
		{
			Serial.SnapInterpolation();
			Parallel.SnapInterpolation();
			Serial.RebuildNeighborSearch(Context);
			Parallel.RebuildNeighborSearch(Context);
			if (Serial.IntegrateNextVelocities(1.0 / 60, Context) != Parallel.IntegrateNextVelocities(1.0 / 60, Context))
			{
				return false;
			}
			Serial.CommitVelocitiesAndIntegratePositions(1.0 / 60, Context);
			Parallel.CommitVelocitiesAndIntegratePositions(1.0 / 60, Context);
			const FBirdFlockBuffers Current = Parallel.GetAbiBuffers();
			const float* ExpectedVelocity = Step % 2 == 0 ? Original.NextVelocities : Original.Velocities;
			if (!SameBuffers(Serial, Parallel) || Current.Positions != Original.Positions || Current.PreviousPositions != Original.PreviousPositions || Current.Velocities != ExpectedVelocity)
			{
				return false;
			}
		}

		Config.Bounds = {{18, 18, 18}};
		PlaceContactCases(Serial, Count);
		PlaceContactCases(Parallel, Count);
		Serial.ReconcileBounds(Context);
		Parallel.ReconcileBounds(Context);
		if (!SameBuffers(Serial, Parallel))
		{
			return false;
		}
		Snapshot.Descriptors[0].Radius = 6;
		Snapshot.Descriptors[1].Dimensions = {8, 10, 12};
		Obstacles.Synchronize(Snapshot);
		Serial.ReconcileObstacles(Context);
		Parallel.ReconcileObstacles(Context);
		return SameBuffers(Serial, Parallel) && std::memcmp(Parallel.GetAbiBuffers().Positions, Parallel.GetAbiBuffers().PreviousPositions, constants::BirdVectorComponentCount * sizeof(float)) == 0;
	}
} // namespace

int main()
{
	if (!ExecutorCoverageAndReuse() || !ExecutorIsolationAndShutdown())
	{
		std::cerr << "FAIL: worker coverage, completion, reuse, isolation or shutdown\n";
		return 1;
	}
	using namespace boids;
	int ScenarioCount = 0;
	for (int Count : {0, 1, 255, 256, 257, 1200})
	{
		for (EBoundaryMode Mode : {EBoundaryMode::Hard, EBoundaryMode::Soft, EBoundaryMode::Hybrid})
		{
			for (ESearchMethod Search : {ESearchMethod::Grid, ESearchMethod::KdTree, ESearchMethod::AllPairs})
			{
				for (bool bObstaclesEnabled : {false, true})
				{
					if (!FlockScenario(Count, Mode, Search, bObstaclesEnabled))
					{
						std::cerr << "FAIL: serial/parallel buffers: count=" << Count << ", boundary=" << static_cast<int>(Mode) << ", search=" << static_cast<int>(Search) << ", obstacles=" << bObstaclesEnabled << '\n';
						return 1;
					}
					++ScenarioCount;
				}
			}
		}
	}
	std::cout << "PASS: " << ScenarioCount << " serial/parallel flock scenarios are bitwise identical, including reconciliation and ABI buffer roles\n";
}
