#include "simulation/BirdUpdateExecutor.h"
#include <algorithm>
#include <cassert>

FBirdUpdateExecutor::FBirdUpdateExecutor(int RequestedWorkerThreadLimit)
{
#if defined(BOIDS_ENABLE_THREADS) && !defined(__EMSCRIPTEN__)
	const unsigned int HardwareThreadCount = std::thread::hardware_concurrency();
	const unsigned int AvailableWorkerThreadCount = HardwareThreadCount > 0 ? HardwareThreadCount - 1 : 0;
	const int HardwareWorkerThreadLimit = static_cast<int>(std::min(AvailableWorkerThreadCount, static_cast<unsigned int>(constants::MaximumBirdWorkerCount)));
	WorkerThreadLimit = std::clamp(RequestedWorkerThreadLimit, 0, HardwareWorkerThreadLimit);
#else
	static_cast<void>(RequestedWorkerThreadLimit);
#endif
}

FBirdUpdateExecutor::~FBirdUpdateExecutor()
{
#if defined(BOIDS_ENABLE_THREADS) && !defined(__EMSCRIPTEN__)
	{
		std::lock_guard<std::mutex> Lock(BatchStateMutex);
		bStopRequested = true;
	}
	BatchPublishedCondition.notify_all();
	for (std::thread& Worker : WorkerThreads)
	{
		Worker.join();
	}
#endif
}

int FBirdUpdateExecutor::GetLastExecutionWorkerCount() const
{
	return LastExecutionWorkerCount;
}

void FBirdUpdateExecutor::FBirdUpdateBatch::ExecuteRange(int RangeIndex) const
{
	const int FirstBirdIndex = BirdCount * RangeIndex / RangeCount;
	const int EndBirdIndexExclusive = BirdCount * (RangeIndex + 1) / RangeCount;
	InvokeRangeTask(BorrowedRangeTaskObject, FirstBirdIndex, EndBirdIndexExclusive);
}

void FBirdUpdateExecutor::ExecuteBatchAndWait(FBirdUpdateBatch Batch)
{
	assert(Batch.BirdCount >= 0 && Batch.BirdCount <= constants::MaxBirdCount);
	LastExecutionWorkerCount = 0;
	if (Batch.BirdCount <= 0)
	{
		return;
	}
#if defined(BOIDS_ENABLE_THREADS) && !defined(__EMSCRIPTEN__)
	if (Batch.BirdCount > 1 && WorkerThreadLimit > 0)
	{
		StartWorkerThreadsIfNeeded();
		// 구간마다 최소 한 개체를 배정합니다. 적은 개체 수에서는 일부 워커만 참여합니다.
		Batch.RangeCount = std::min(Batch.BirdCount, static_cast<int>(WorkerThreads.size()) + 1);
		PublishBatch(Batch);

		// 호출 스레드가 첫 구간을 맡고 워커들이 나머지 구간을 처리합니다.
		Batch.ExecuteRange(0);
		WaitForWorkersAndClearBatch();
		LastExecutionWorkerCount = Batch.RangeCount - 1;
		return;
	}
#endif
	Batch.ExecuteRange(0);
}

#if defined(BOIDS_ENABLE_THREADS) && !defined(__EMSCRIPTEN__)
void FBirdUpdateExecutor::StartWorkerThreadsIfNeeded()
{
	if (!WorkerThreads.empty())
	{
		return;
	}
	WorkerThreads.reserve(static_cast<std::size_t>(WorkerThreadLimit));
	for (int RangeIndex = 1; RangeIndex <= WorkerThreadLimit; ++RangeIndex)
	{
		WorkerThreads.emplace_back(&FBirdUpdateExecutor::RunWorkerLoop, this, RangeIndex);
	}
}

void FBirdUpdateExecutor::PublishBatch(const FBirdUpdateBatch& Batch)
{
	{
		std::lock_guard<std::mutex> Lock(BatchStateMutex);
		ActiveBatch = Batch;
		RemainingWorkerCount = Batch.RangeCount - 1;
		++PublishedBatchSequence;
	}
	BatchPublishedCondition.notify_all();
}

void FBirdUpdateExecutor::WaitForWorkersAndClearBatch()
{
	std::unique_lock<std::mutex> Lock(BatchStateMutex);
	const auto AreAllAssignedWorkersFinished = [this]
	{
		return RemainingWorkerCount == 0;
	};
	WorkersFinishedCondition.wait(Lock, AreAllAssignedWorkersFinished);
	// 모든 구간이 끝났으므로 호출자의 람다와 그 캡처를 더 이상 참조하지 않습니다.
	ActiveBatch = {};
}

void FBirdUpdateExecutor::RunWorkerLoop(int RangeIndex)
{
	std::uint64_t LastObservedBatchSequence = 0;
	for (;;)
	{
		FBirdUpdateBatch AssignedBatch;
		{
			std::unique_lock<std::mutex> Lock(BatchStateMutex);
			// 세대 번호를 함께 확인하여 알림이 먼저 도착하거나 허위 기상이 발생해도 작업을 잃지 않습니다.
			const auto HasNewBatchOrStopRequest = [this, &LastObservedBatchSequence]
			{
				return bStopRequested || PublishedBatchSequence != LastObservedBatchSequence;
			};
			BatchPublishedCondition.wait(Lock, HasNewBatchOrStopRequest);
			if (bStopRequested)
			{
				return;
			}
			LastObservedBatchSequence = PublishedBatchSequence;
			if (RangeIndex >= ActiveBatch.RangeCount)
			{
				// 이 워커의 구간이 없는 작은 작업입니다. 완료 수에 포함하지 않고 다시 대기합니다.
				continue;
			}
			AssignedBatch = ActiveBatch;
		}

		AssignedBatch.ExecuteRange(RangeIndex);
		{
			// 작업의 쓰기를 완료 대기 호출자에게 공개한 뒤 남은 워커 수를 줄입니다.
			std::lock_guard<std::mutex> Lock(BatchStateMutex);
			--RemainingWorkerCount;
			if (RemainingWorkerCount == 0)
			{
				WorkersFinishedCondition.notify_one();
			}
		}
	}
}
#endif
