#include "simulation/BirdUpdateExecutor.h"
#include <algorithm>
#include <cassert>

namespace boids
{
	FBirdUpdateExecutor::FBirdUpdateExecutor(int InMaxWorkerCount)
	{
#if defined(BOIDS_ENABLE_THREADS) && !defined(__EMSCRIPTEN__)
		const unsigned int HardwareThreads = std::thread::hardware_concurrency();
		const unsigned int AvailableWorkers = HardwareThreads > 0 ? HardwareThreads - 1 : 0;
		const int WorkerLimit = static_cast<int>(std::min(AvailableWorkers, static_cast<unsigned int>(constants::MaximumBirdWorkerCount)));
		MaxWorkerCount = std::clamp(InMaxWorkerCount, 0, WorkerLimit);
#else
		static_cast<void>(InMaxWorkerCount);
#endif
	}

	FBirdUpdateExecutor::~FBirdUpdateExecutor()
	{
#if defined(BOIDS_ENABLE_THREADS) && !defined(__EMSCRIPTEN__)
		{
			std::lock_guard<std::mutex> Lock(Mutex);
			bStopping = true;
		}
		WorkAvailable.notify_all();
		for (std::thread& Worker : Workers)
		{
			Worker.join();
		}
#endif
	}

	void FBirdUpdateExecutor::Execute(int BirdCount, const void* Context, FRangeFunction Function)
	{
		assert(BirdCount >= 0 && BirdCount <= constants::MaxBirdCount);
		if (BirdCount <= 0)
		{
			return;
		}
#if defined(BOIDS_ENABLE_THREADS) && !defined(__EMSCRIPTEN__)
		if (BirdCount >= constants::MinimumParallelBirdCount && MaxWorkerCount > 0)
		{
			StartWorkers();
			const int RangeCount = static_cast<int>(Workers.size()) + 1;
			{
				std::lock_guard<std::mutex> Lock(Mutex);
				JobContext = Context;
				JobFunction = Function;
				JobBirdCount = BirdCount;
				JobRangeCount = RangeCount;
				PendingWorkerCount = static_cast<int>(Workers.size());
				++JobGeneration;
			}
			WorkAvailable.notify_all();

			// 호출 스레드가 첫 구간을 맡고 워커들이 나머지 구간을 처리합니다.
			Function(Context, 0, BirdCount / RangeCount);
			{
				std::unique_lock<std::mutex> Lock(Mutex);
				const auto IsComplete = [this]
				{
					return PendingWorkerCount == 0;
				};
				WorkCompleted.wait(Lock, IsComplete);
				// 캡처한 스택 문맥이 반환 후에도 남아 있지 않도록 대여 포인터를 해제합니다.
				JobContext = nullptr;
				JobFunction = nullptr;
			}
			return;
		}
#endif
		Function(Context, 0, BirdCount);
	}

#if defined(BOIDS_ENABLE_THREADS) && !defined(__EMSCRIPTEN__)
	void FBirdUpdateExecutor::StartWorkers()
	{
		if (!Workers.empty())
		{
			return;
		}
		Workers.reserve(static_cast<std::size_t>(MaxWorkerCount));
		for (int RangeIndex = 1; RangeIndex <= MaxWorkerCount; ++RangeIndex)
		{
			Workers.emplace_back(&FBirdUpdateExecutor::WorkerLoop, this, RangeIndex);
		}
	}

	void FBirdUpdateExecutor::WorkerLoop(int RangeIndex)
	{
		std::uint64_t SeenGeneration = 0;
		for (;;)
		{
			const void* Context;
			FRangeFunction Function;
			int BirdCount;
			int RangeCount;
			{
				std::unique_lock<std::mutex> Lock(Mutex);
				// 세대 번호를 함께 확인하여 알림이 먼저 도착하거나 허위 기상이 발생해도 작업을 잃지 않습니다.
				const auto HasWorkOrStop = [this, &SeenGeneration]
				{
					return bStopping || JobGeneration != SeenGeneration;
				};
				WorkAvailable.wait(Lock, HasWorkOrStop);
				if (bStopping)
				{
					return;
				}
				SeenGeneration = JobGeneration;
				Context = JobContext;
				Function = JobFunction;
				BirdCount = JobBirdCount;
				RangeCount = JobRangeCount;
			}

			Function(Context, BirdCount * RangeIndex / RangeCount, BirdCount * (RangeIndex + 1) / RangeCount);
			{
				// 작업의 쓰기를 완료 대기 호출자에게 공개한 뒤 남은 워커 수를 줄입니다.
				std::lock_guard<std::mutex> Lock(Mutex);
				--PendingWorkerCount;
				if (PendingWorkerCount == 0)
				{
					WorkCompleted.notify_one();
				}
			}
		}
	}
#endif
} // namespace boids
