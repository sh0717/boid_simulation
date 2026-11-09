#pragma once

#include "core/SimulationConstants.h"
#include "simulation/ParallelExecutor.h"
#include <cassert>
#include <cstddef>

/**
 * 군집의 개체 수·워커 상한·진단 계약을 공통 동기 실행기에 연결합니다.
 * @note 네이티브는 개체 2개 이상에서 고정 구간을 병렬 실행하며 Wasm은 직렬 실행합니다.
 * @note 같은 실행기의 중첩·동시 호출과 작업 예외는 지원하지 않습니다.
 */
class FBirdUpdateExecutor
{
public:
	/**
	 * 호출 스레드 외의 워커 상한을 하드웨어 동시성과 프로젝트 상한 안으로 제한합니다.
	 * @param RequestedWorkerThreadLimit 0 이하는 직렬 실행합니다. 워커는 첫 병렬 작업에서 생성합니다.
	 */
	explicit FBirdUpdateExecutor(int RequestedWorkerThreadLimit = constants::MaximumBirdWorkerCount);

	/** 대기 중인 워커를 깨우고 join합니다. 실행 중에는 소멸시키지 않습니다. */
	~FBirdUpdateExecutor() = default;

	FBirdUpdateExecutor(const FBirdUpdateExecutor&) = delete;

	FBirdUpdateExecutor& operator=(const FBirdUpdateExecutor&) = delete;

	FBirdUpdateExecutor(FBirdUpdateExecutor&&) = delete;

	FBirdUpdateExecutor& operator=(FBirdUpdateExecutor&&) = delete;

	/** 최근 완료한 구간 작업에 배정된 워커 수입니다. 호출 스레드는 제외하며 실행과 동시에 조회하지 않습니다. */
	[[nodiscard]] int GetLastExecutionWorkerCount() const;

	/**
	 * [0, BirdCount)를 겹치지 않는 연속 구간으로 나누고 전체 작업 완료 뒤 반환합니다.
	 * @param BirdCount [0, MaxBirdCount] 범위입니다. 0이면 콜백을 호출하지 않습니다.
	 * @param RangeTask (FirstBirdIndex, EndBirdIndexExclusive)를 받으며 const 호출 가능하고 void 반환·noexcept인 대여 함수 객체입니다.
	 * @pre 작업은 자기 구간만 수정하며 함수 객체와 캡처는 호출이 반환할 때까지 유효해야 합니다.
	 * @note 작업은 예외를 던지지 않아야 하며 같은 실행기의 중첩·동시 호출은 금지합니다.
	 */
	template <typename RangeTaskType>
		requires CParallelTask<RangeTaskType, int, int>
	void ExecuteBirdRangesAndWait(int BirdCount, const RangeTaskType& RangeTask)
	{
		assert(BirdCount >= 0 && BirdCount <= constants::MaxBirdCount);

		// 군집의 int 인덱스와 공통 실행기의 size_t 인덱스 사이를 이 경계에서만 변환합니다.
		const auto ExecuteBirdRange = [&RangeTask](std::size_t FirstIndex, std::size_t EndIndexExclusive) noexcept
		{
			RangeTask(static_cast<int>(FirstIndex), static_cast<int>(EndIndexExclusive));
		};

		const std::size_t ItemCount = BirdCount > 0 ? static_cast<std::size_t>(BirdCount) : 0;
		Executor.ExecuteRangesAndWait(ItemCount, ExecuteBirdRange, EParallelSchedule::FixedRanges);
	}

private:
	// 작업 객체는 소유하지 않으며 워커·게시·완료·종료 수명은 공통 실행기가 소유합니다.
	FParallelExecutor Executor;
};
