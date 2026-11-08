#pragma once

#include "core/SimulationConstants.h"
#if defined(BOIDS_ENABLE_THREADS) && !defined(__EMSCRIPTEN__)
#include <condition_variable>
#include <cstdint>
#include <mutex>
#include <thread>
#include <vector>
#endif

/**
 * 서로 독립된 개체 구간을 실행하는 동기식 실행기입니다. 호출 스레드도 한 구간을 처리합니다.
 * 네이티브는 개체 2개 이상이면 기본 병렬 실행하며 워커는 첫 작업에서 생성해 재사용합니다.
 * 같은 실행기의 중첩·동시 호출은 지원하지 않습니다. 작업은 예외를 던지지 않아야 합니다.
 * Wasm·스레드 비활성·워커 상한 0·사용 가능한 워커 없음·개체 1개는 직렬 실행합니다.
 */
class FBirdUpdateExecutor
{
public:
	/**
	 * 호출 스레드 외의 워커 수 상한을 프로젝트 상한과 하드웨어 동시성 안으로 제한합니다.
	 * @param RequestedWorkerThreadLimit 0이면 직렬 실행합니다. 동시성 정보를 얻지 못한 경우에도 직렬로 실행합니다.
	 * @note 생성자에서는 스레드를 만들지 않으며 개체 2개 이상의 첫 작업에서 지연 생성합니다.
	 */
	explicit FBirdUpdateExecutor(int RequestedWorkerThreadLimit = constants::MaximumBirdWorkerCount);

	/**
	 * 종료 상태를 설정하고 대기 중인 워커를 깨운 뒤 모든 std::thread를 join합니다.
	 * @pre 같은 실행기의 ExecuteBirdRangesAndWait가 진행 중인 상태에서 소멸시키지 않아야 합니다.
	 */
	~FBirdUpdateExecutor();

	FBirdUpdateExecutor(const FBirdUpdateExecutor&) = delete;

	FBirdUpdateExecutor& operator=(const FBirdUpdateExecutor&) = delete;

	FBirdUpdateExecutor(FBirdUpdateExecutor&&) = delete;

	FBirdUpdateExecutor& operator=(FBirdUpdateExecutor&&) = delete;

	/** 최근 완료한 구간 작업에 참여한 워커 수입니다. 호출 스레드는 제외하며 작업 전에는 0입니다. 갱신과 동시에 조회하지 않습니다. */
	[[nodiscard]] int GetLastExecutionWorkerCount() const;

	/**
	 * [0, BirdCount)를 겹치지 않는 연속 구간으로 나누고 호출 스레드도 한 구간을 처리합니다.
	 * @param BirdCount [0, MaxBirdCount] 범위의 개체 수입니다. 0이면 작업 함수를 호출하지 않습니다.
	 * @param RangeTask (FirstBirdIndex, EndBirdIndexExclusive)를 받아 반열린 구간의 개체를 처리할 람다 또는 함수 객체입니다.
	 * @note 전체 구간 완료 후 반환합니다. 함수 객체와 캡처는 호출 동안만 빌리며 작업별 할당은 하지 않습니다.
	 * @note 작업은 자기 구간만 수정하고 예외를 던지지 않아야 합니다. 같은 실행기의 중첩·동시 호출은 금지합니다.
	 * @code
	 * Executor.ExecuteBirdRangesAndWait(BirdCount, [&Birds](int FirstBirdIndex, int EndBirdIndexExclusive)
	 * {
	 *     // FirstBirdIndex 이상 EndBirdIndexExclusive 미만의 개체만 수정합니다.
	 * });
	 * @endcode
	 */
	template <typename RangeTaskType>
	void ExecuteBirdRangesAndWait(int BirdCount, const RangeTaskType& RangeTask)
	{
		// 캡처가 있는 람다의 주소와 그 타입을 복원하는 호출 함수를 한 쌍으로 전달합니다.
		// RangeTask를 복사·소유하지 않으며 모든 워커가 끝나기 전에 이 함수는 반환하지 않습니다.
		const auto InvokeRangeTask = [](const void* BorrowedRangeTaskObject, int FirstBirdIndex, int EndBirdIndexExclusive)
		{
			const RangeTaskType& OriginalRangeTask = *static_cast<const RangeTaskType*>(BorrowedRangeTaskObject);
			OriginalRangeTask(FirstBirdIndex, EndBirdIndexExclusive);
		};

		FBirdUpdateBatch Batch;
		Batch.BorrowedRangeTaskObject = &RangeTask;
		Batch.InvokeRangeTask = InvokeRangeTask;
		Batch.BirdCount = BirdCount;

		ExecuteBatchAndWait(Batch);
	}

private:
	// 작업 객체 주소를 원래 타입으로 복원하고 지정 구간을 호출하는 함수 포인터입니다.
	using FRangeTaskInvoker = void (*)(const void* BorrowedRangeTaskObject, int FirstBirdIndex, int EndBirdIndexExclusive);

	// 한 번의 호출에 필요한 콜백과 구간 분할 정보입니다. 콜백 객체 자체를 소유하지 않습니다.
	struct FBirdUpdateBatch
	{
		const void* BorrowedRangeTaskObject = nullptr;

		FRangeTaskInvoker InvokeRangeTask = nullptr;

		int BirdCount = 0;

		// 0번은 호출 스레드, 1번 이후는 워커가 처리합니다. 직렬 실행은 한 구간입니다.
		int RangeCount = 1;

		void ExecuteRange(int RangeIndex) const;
	};

	// 빈 작업·직렬·병렬 실행을 선택하고 모든 구간이 완료된 후 반환합니다.
	void ExecuteBatchAndWait(FBirdUpdateBatch Batch);

	// 조율 스레드가 기록하고 작업 반환 후 읽습니다. 대기 중인 풀의 크기와는 구분합니다.
	int LastExecutionWorkerCount = 0;

#if defined(BOIDS_ENABLE_THREADS) && !defined(__EMSCRIPTEN__)
	/**
	 * 첫 병렬 작업에서 고정된 구간 번호를 가진 워커를 생성하고 이후 호출에서는 기존 워커를 재사용합니다.
	 * @note 작업 배포 전 조율 스레드만 호출합니다. 워커는 생성 후 새 작업 또는 종료 신호를 기다립니다.
	 */
	void StartWorkerThreadsIfNeeded();

	// 작업 정보를 잠금 아래 게시하고 순번을 증가시킨 뒤 워커를 깨웁니다.
	void PublishBatch(const FBirdUpdateBatch& Batch);

	// 모든 배정 워커의 완료를 기다린 뒤 공유 작업에서 콜백 대여를 해제합니다.
	void WaitForWorkersAndClearBatch();

	// 고유 RangeIndex의 작업을 반복 실행합니다. 종료 신호를 받으면 반환합니다.
	void RunWorkerLoop(int RangeIndex);

	int WorkerThreadLimit = 0;

	// ActiveBatch·완료 수·게시 순번·종료 상태를 함께 보호합니다.
	std::mutex BatchStateMutex;

	std::condition_variable BatchPublishedCondition;

	std::condition_variable WorkersFinishedCondition;

	std::vector<std::thread> WorkerThreads;

	// 잠금 아래 게시·복사·초기화합니다. 개체 계산은 워커별 복사본으로 잠금 밖에서 실행합니다.
	FBirdUpdateBatch ActiveBatch;

	// 호출 스레드를 제외한, 이번 작업에 배정되어 아직 완료하지 않은 워커 수입니다.
	int RemainingWorkerCount = 0;

	// 워커는 자신이 관찰한 순번과 비교해 같은 작업을 두 번 실행하지 않습니다.
	std::uint64_t PublishedBatchSequence = 0;

	bool bStopRequested = false;
#endif
};
