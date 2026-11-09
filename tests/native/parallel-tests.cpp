#include "simulation/BirdFlock.h"
#include "simulation/BirdUpdateExecutor.h"
#include <algorithm>
#include <array>
#include <atomic>
#include <cstring>
#include <iostream>
#include <limits>
#include <mutex>
#include <set>
#include <thread>
#include <vector>

namespace
{

	// 선언의 제약을 검사합니다. 본문 안의 static_assert만으로는 잘못된 호출이 여기서 거부되지 않습니다.
	template <typename TaskType>
	concept CAcceptsRangeTask = requires(FParallelExecutor& Executor, const TaskType& Task) {
		Executor.ExecuteRangesAndWait(1, Task);
	};

	template <typename TaskType>
	concept CAcceptsIndexTask = requires(FParallelExecutor& Executor, const TaskType& Task) {
		Executor.Run(1, Task);
	};

	using FValidRangeTask = decltype([](std::size_t, std::size_t) noexcept
	{
	});
	using FValidIndexTask = decltype([](std::size_t) noexcept
	{
	});
	using FThrowingRangeTask = decltype([](std::size_t, std::size_t)
	{
	});
	using FThrowingIndexTask = decltype([](std::size_t)
	{
	});
	using FMutableTask = decltype([Count = 0](auto...) mutable noexcept
	{
		++Count;
	});
	using FValueReturningTask = decltype([](auto...) noexcept
	{
		return 1;
	});
	using FRvalueOnlyTask = decltype([](std::size_t&&, auto&&...) noexcept
	{
	});

	struct FVolatileTask
	{
		void operator()(...) const volatile noexcept {}
	};

	using FRawRangeTask = void(std::size_t, std::size_t) noexcept;
	using FRawIndexTask = void(std::size_t) noexcept;

	static_assert(CAcceptsRangeTask<FValidRangeTask> && CAcceptsIndexTask<FValidIndexTask>);
	static_assert(!CAcceptsRangeTask<FValidIndexTask> && !CAcceptsIndexTask<FValidRangeTask>);
	static_assert(!CAcceptsRangeTask<FThrowingRangeTask> && !CAcceptsIndexTask<FThrowingIndexTask>);
	static_assert(!CAcceptsRangeTask<FMutableTask> && !CAcceptsIndexTask<FMutableTask>);
	static_assert(!CAcceptsRangeTask<FValueReturningTask> && !CAcceptsIndexTask<FValueReturningTask>);
	static_assert(!CAcceptsRangeTask<FRvalueOnlyTask> && !CAcceptsIndexTask<FRvalueOnlyTask>);
	static_assert(!CAcceptsRangeTask<volatile FVolatileTask> && !CAcceptsIndexTask<volatile FVolatileTask>);
	static_assert(!CAcceptsRangeTask<int> && !CAcceptsIndexTask<int>);
	static_assert(!CAcceptsRangeTask<FRawRangeTask> && !CAcceptsIndexTask<FRawIndexTask>);
	static_assert(CAcceptsRangeTask<FRawRangeTask*> && CAcceptsIndexTask<FRawIndexTask*>);

	template <typename TaskType>
	concept CAcceptsBirdRangeTask = requires(FBirdUpdateExecutor& Executor, const TaskType& Task) {
		Executor.ExecuteBirdRangesAndWait(1, Task);
	};

	static_assert(CAcceptsBirdRangeTask<decltype([](int, int) noexcept
	{
	})>);
	static_assert(!CAcceptsBirdRangeTask<decltype([](int, int)
	{
	})>);
	static_assert(!CAcceptsBirdRangeTask<FMutableTask>);
	static_assert(!CAcceptsBirdRangeTask<FValueReturningTask>);
	static_assert(!CAcceptsBirdRangeTask<FValidIndexTask>);
	static_assert(!CAcceptsBirdRangeTask<decltype([](int&, int&) noexcept
	{
	})>);
	static_assert(CAcceptsBirdRangeTask<decltype([](int&&, int&&) noexcept
	{
	})>);

	struct FNonCopyableRangeTask
	{
		explicit FNonCopyableRangeTask(std::vector<std::atomic<int>>& InVisits)
			: Visits(InVisits)
		{
		}

		FNonCopyableRangeTask(const FNonCopyableRangeTask&) = delete;

		FNonCopyableRangeTask& operator=(const FNonCopyableRangeTask&) = delete;

		void operator()(std::size_t First, std::size_t End) const noexcept
		{
			for (std::size_t Index = First; Index < End; ++Index)
			{
				Visits[Index].fetch_add(1);
			}
		}

		// 호출 동안만 빌리는 독립 인덱스의 방문 횟수 저장소입니다.
		std::vector<std::atomic<int>>& Visits;
	};

	static_assert(CAcceptsRangeTask<FNonCopyableRangeTask>);

	bool SharedExecutorContracts()
	{
		FParallelExecutor Executor;
		std::vector<std::atomic<int>> Visits(19);
		const FNonCopyableRangeTask Task(Visits);
		for (EParallelSchedule Schedule : {EParallelSchedule::FixedRanges, EParallelSchedule::DynamicIndices})
		{
			Executor.ExecuteRangesAndWait(Visits.size(), Task, Schedule);
		}
		Executor.Run(Visits.size(), [&Visits](std::size_t Index) noexcept
		{
			Visits[Index].fetch_add(1);
		});
		for (const std::atomic<int>& Visit : Visits)
		{
			if (Visit.load() != 3)
			{
				return false;
			}
		}

		// 큰 size_t 범위를 실제 순회하지 않고 분할 끝값의 오버플로와 빈 구간을 검사합니다.
		using FIndexRange = std::array<std::size_t, 2>;
		std::vector<FIndexRange> Ranges;
		std::mutex RangesMutex;
		const std::size_t Count = std::numeric_limits<std::size_t>::max();
		Executor.ExecuteRangesAndWait(Count, [&Ranges, &RangesMutex](std::size_t First, std::size_t End) noexcept
		{
			const std::lock_guard<std::mutex> Lock(RangesMutex);
			Ranges.push_back({First, End});
		});
		std::sort(Ranges.begin(), Ranges.end());
		std::size_t PreviousEnd = 0;
		for (const FIndexRange& Range : Ranges)
		{
			if (Range[0] != PreviousEnd || Range[0] >= Range[1])
			{
				return false;
			}
			PreviousEnd = Range[1];
		}
		if (PreviousEnd != Count)
		{
			return false;
		}

		std::size_t EmptyCalls = 0;
		Executor.Run(0, [&EmptyCalls](std::size_t) noexcept
		{
			++EmptyCalls;
		});
		if (EmptyCalls != 0 || Executor.GetLastExecutionWorkerCount() != 0)
		{
			return false;
		}
		std::cout << "PASS: shared fixed/dynamic scheduler coverage, borrowed noncopyable tasks, size_t range bounds and empty telemetry\n";
		return true;
	}

	bool ExecutorCoverageAndReuse()
	{
		FBirdUpdateExecutor Executor;
		if (Executor.GetLastExecutionWorkerCount() != 0)
		{
			return false;
		}
		const std::array<int, 15> Counts = {0, 1, 2, 3, 4, 17, 32, 255, 256, 257, 1200, 10000, 2, 1200, 10000};
		std::array<std::set<std::thread::id>, Counts.size()> FirstTeams;
		const unsigned int HardwareThreadCount = std::thread::hardware_concurrency();
		const int ExpectedTeamLimit = HardwareThreadCount > 1 ? static_cast<int>(std::min(HardwareThreadCount, static_cast<unsigned int>(constants::MaximumBirdWorkerCount + 1))) : 1;
		for (int Repeat = 0; Repeat < 8; ++Repeat)
		{
			for (std::size_t CaseIndex = 0; CaseIndex < Counts.size(); ++CaseIndex)
			{
				const int Count = Counts[CaseIndex];
				std::vector<std::atomic<int>> Visits(constants::MaxBirdCount);
				std::vector<std::thread::id> ThreadIds(constants::MaxBirdCount);
				std::atomic<int> RangeCalls{0};
				std::atomic<bool> bInvalidRange{false};
				Executor.ExecuteBirdRangesAndWait(Count, [&RangeCalls, &bInvalidRange, &Visits, &ThreadIds, Count](int FirstBirdIndex, int EndBirdIndexExclusive) noexcept
				{
					RangeCalls.fetch_add(1);
					if (FirstBirdIndex < 0 || FirstBirdIndex >= EndBirdIndexExclusive || EndBirdIndexExclusive > Count)
					{
						bInvalidRange.store(true);
						return;
					}
					for (int BirdIndex = FirstBirdIndex; BirdIndex < EndBirdIndexExclusive; ++BirdIndex)
					{
						if (Visits[BirdIndex].fetch_add(1) == 0)
						{
							ThreadIds[BirdIndex] = std::this_thread::get_id();
						}
					}
				});
				const int ExpectedWorkerCount = std::max(0, std::min(Count, ExpectedTeamLimit) - 1);
				if (bInvalidRange.load() || Executor.GetLastExecutionWorkerCount() != ExpectedWorkerCount)
				{
					return false;
				}
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
				const int ExpectedTeamSize = std::min(Count, ExpectedTeamLimit);
				if (static_cast<int>(Team.size()) != ExpectedTeamSize || RangeCalls.load() != ExpectedTeamSize || !Team.contains(std::this_thread::get_id()))
				{
					return false;
				}
				if (Repeat == 0)
				{
					FirstTeams[CaseIndex] = Team;
				}
				else if (FirstTeams[CaseIndex] != Team)
				{
					return false;
				}
			}
		}
		std::cout << "PASS: exact nonempty range coverage, completion, default parallel small flocks and " << ExpectedTeamLimit << " reused execution threads\n";
		return true;
	}

	bool ExplicitSerialWorkerLimit()
	{
		FBirdUpdateExecutor SerialExecutor(0);
		for (int Count : {0, 1, 2, 32, 1200, 10000})
		{
			int RangeCallCount = 0;
			bool bExpectedCallerRange = true;
			const std::thread::id CallerThreadId = std::this_thread::get_id();
			SerialExecutor.ExecuteBirdRangesAndWait(Count, [&RangeCallCount, &bExpectedCallerRange, CallerThreadId, Count](int FirstBirdIndex, int EndBirdIndexExclusive) noexcept
			{
				++RangeCallCount;
				bExpectedCallerRange = bExpectedCallerRange && std::this_thread::get_id() == CallerThreadId && FirstBirdIndex == 0 && EndBirdIndexExclusive == Count;
			});
			if (!bExpectedCallerRange || RangeCallCount != (Count == 0 ? 0 : 1) || SerialExecutor.GetLastExecutionWorkerCount() != 0)
			{
				return false;
			}
		}
		std::cout << "PASS: explicit zero worker limit runs only on the caller thread\n";
		return true;
	}

	bool ReleaseNegativeCountGuard()
	{
#if defined(NDEBUG)
		FBirdUpdateExecutor Executor;
		int Calls = 0;
		Executor.ExecuteBirdRangesAndWait(-1, [&Calls](int, int) noexcept
		{
			++Calls;
		});
		return Calls == 0 && Executor.GetLastExecutionWorkerCount() == 0;
#else
		return true;
#endif
	}

	bool ExecutorIsolationAndShutdown()
	{
		for (int Repeat = 0; Repeat < 8; ++Repeat)
		{
			std::array<int, 1200> First{};
			std::array<int, 1200> Second{};
			std::thread FirstCaller([&First]
			{
				FBirdUpdateExecutor Executor;
				Executor.ExecuteBirdRangesAndWait(1200, [&First](int Begin, int End) noexcept
				{
					std::fill(First.begin() + Begin, First.begin() + End, 7);
				});
			});
			std::thread SecondCaller([&Second]
			{
				FBirdUpdateExecutor Executor;
				Executor.ExecuteBirdRangesAndWait(1200, [&Second](int Begin, int End) noexcept
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

	bool SameBuffers(FBirdFlock& First, FBirdFlock& Second)
	{
		const FBirdFlockBuffers A = First.GetAbiBuffers();
		const FBirdFlockBuffers B = Second.GetAbiBuffers();
		const std::size_t VectorBytes = constants::BirdVectorComponentCount * sizeof(float);
		const std::size_t IndexBytes = constants::MaxBirdCount * sizeof(std::uint16_t);
		return std::memcmp(A.Positions, B.Positions, VectorBytes) == 0 && std::memcmp(A.PreviousPositions, B.PreviousPositions, VectorBytes) == 0 && std::memcmp(A.Velocities, B.Velocities, VectorBytes) == 0 && std::memcmp(A.NextVelocities, B.NextVelocities, VectorBytes) == 0 && std::memcmp(A.NeighborCounts, B.NeighborCounts, IndexBytes) == 0 && std::memcmp(A.InspectionNeighborIndices, B.InspectionNeighborIndices, IndexBytes) == 0 && std::memcmp(A.Inspection, B.Inspection, constants::InspectionValueCount * sizeof(double)) == 0;
	}

	void PlaceContactCases(FBirdFlock& Flock, int Count)
	{
		// 구 중심·상자 중심·월드 밖·경계 근처에 배치하여 실제 접촉 분기를 통과시킵니다.
		const std::array<std::array<float, 3>, 4> Positions = {{{0, 0, 0}, {10, 0, 0}, {30, -30, 30}, {24.9f, 24.9f, -24.9f}}};
		const FBirdFlockBuffers Buffers = Flock.GetAbiBuffers();
		for (int BirdIndex = 0; BirdIndex < Count; ++BirdIndex)
		{
			std::copy(Positions[BirdIndex % Positions.size()].begin(), Positions[BirdIndex % Positions.size()].end(), Buffers.Positions + BirdIndex * 3);
			Buffers.Velocities[BirdIndex * 3] = 4;
			Buffers.Velocities[BirdIndex * 3 + 1] = -3;
			Buffers.Velocities[BirdIndex * 3 + 2] = 2;
		}
	}

	bool FlockScenario(int Count, EBoundaryMode BoundaryMode, ESearchMethod SearchMethod, bool bObstaclesEnabled)
	{
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
			const unsigned int HardwareThreadCount = std::thread::hardware_concurrency();
			const int AvailableWorkerCount = HardwareThreadCount > 1 ? static_cast<int>(std::min(HardwareThreadCount - 1, static_cast<unsigned int>(constants::MaximumBirdWorkerCount))) : 0;
			const int ExpectedWorkerCount = std::max(0, std::min(Count - 1, AvailableWorkerCount));
			if (Serial.GetLastUpdateWorkerCount() != 0 || Parallel.GetLastUpdateWorkerCount() != ExpectedWorkerCount)
			{
				return false;
			}
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
	if (!SharedExecutorContracts() || !ExecutorCoverageAndReuse() || !ExplicitSerialWorkerLimit() || !ReleaseNegativeCountGuard() || !ExecutorIsolationAndShutdown())
	{
		std::cerr << "FAIL: worker coverage, completion, reuse, isolation or shutdown\n";
		return 1;
	}
	int ScenarioCount = 0;
	for (int Count : {0, 1, 2, 3, 32, 255, 256, 257, 1200})
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
