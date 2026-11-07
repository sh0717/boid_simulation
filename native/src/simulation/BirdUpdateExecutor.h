#pragma once
#include "core/SimulationConstants.h"
#if defined(BOIDS_ENABLE_THREADS) && !defined(__EMSCRIPTEN__)
#include <condition_variable>
#include <cstdint>
#include <mutex>
#include <thread>
#include <vector>
#endif

namespace boids
{
	/**
	 * 서로 독립된 개체 구간을 실행하는 동기식 실행기입니다. 호출 스레드도 한 구간을 처리합니다.
	 * 네이티브 워커는 첫 병렬 작업에서 생성하고 재사용하며, 소멸 시 깨운 뒤 모두 join합니다.
	 * 같은 실행기의 중첩·동시 호출은 지원하지 않습니다. 작업은 예외를 던지지 않아야 합니다.
	 * Wasm·스레드 비활성 빌드와 작은 군집은 호출 스레드에서 직렬로 실행합니다.
	 */
	class FBirdUpdateExecutor
	{
	public:
		/**
		 * 호출 스레드 외의 워커 수 상한을 프로젝트 상한과 하드웨어 동시성 안으로 제한합니다.
		 * @param MaxWorkerCount 0이면 직렬 실행합니다. 동시성 정보를 얻지 못한 경우에도 직렬로 실행합니다.
		 * @note 생성자에서는 스레드를 만들지 않으며 첫 충분히 큰 작업에서 지연 생성합니다.
		 */
		explicit FBirdUpdateExecutor(int MaxWorkerCount = constants::MaximumBirdWorkerCount);

		/**
		 * 종료 상태를 설정하고 대기 중인 워커를 깨운 뒤 모든 std::thread를 join합니다.
		 * @pre 같은 실행기의 ForEachRange가 진행 중인 상태에서 소멸시키지 않아야 합니다.
		 */
		~FBirdUpdateExecutor();

		FBirdUpdateExecutor(const FBirdUpdateExecutor&) = delete;

		FBirdUpdateExecutor& operator=(const FBirdUpdateExecutor&) = delete;

		FBirdUpdateExecutor(FBirdUpdateExecutor&&) = delete;

		FBirdUpdateExecutor& operator=(FBirdUpdateExecutor&&) = delete;

		/**
		 * [0, BirdCount)를 겹치지 않는 연속 구간으로 나누고 호출 스레드도 한 구간을 처리합니다.
		 * @param BirdCount [0, MaxBirdCount] 범위의 개체 수입니다. 0이면 작업 함수를 호출하지 않습니다.
		 * @param Function (FirstBirdIndex, LastBirdIndex)를 받아 반열린 구간의 개체를 처리할 작업입니다.
		 * @note 전체 구간 완료 후 반환합니다. 함수 객체와 캡처는 호출 동안만 빌리며 작업별 할당은 하지 않습니다.
		 * @note 작업은 자기 구간만 수정하고 예외를 던지지 않아야 합니다. 같은 실행기의 중첩·동시 호출은 금지합니다.
		 */
		template <typename FunctionType>
		void ForEachRange(int BirdCount, const FunctionType& Function)
		{
			const auto InvokeRange = [](const void* Context, int FirstBirdIndex, int LastBirdIndex)
			{
				(*static_cast<const FunctionType*>(Context))(FirstBirdIndex, LastBirdIndex);
			};
			Execute(BirdCount, &Function, InvokeRange);
		}

	private:
		using FRangeFunction = void (*)(const void*, int, int);

		/**
		 * 작업 함수와 문맥을 동기 호출 동안 빌려 직렬 실행하거나 워커에게 배포합니다.
		 * 충분히 큰 네이티브 작업은 세대 번호를 갱신해 배포하고 모든 워커의 완료를 기다린 뒤 대여를 해제합니다.
		 * @note Wasm·스레드 비활성·작은 군집에서는 호출 스레드가 전체 구간을 처리합니다.
		 */
		void Execute(int BirdCount, const void* Context, FRangeFunction Function);

#if defined(BOIDS_ENABLE_THREADS) && !defined(__EMSCRIPTEN__)
		/**
		 * 첫 병렬 작업에서 고정된 구간 번호를 가진 워커를 생성하고 이후 호출에서는 기존 워커를 재사용합니다.
		 * @note 작업 배포 전 조율 스레드만 호출합니다. 워커는 생성 후 새 작업 또는 종료 신호를 기다립니다.
		 */
		void StartWorkers();

		/**
		 * 새 세대의 작업 또는 종료 상태를 조건식으로 기다리고 배정 구간을 실행합니다.
		 * @param RangeIndex 호출 스레드의 0번 구간을 제외한 워커 고유의 구간 번호입니다.
		 * @note 완료 수를 Mutex 아래에서 줄이고 마지막 워커가 조율 스레드를 깨웁니다. 종료 상태이면 루프를 끝냅니다.
		 */
		void WorkerLoop(int RangeIndex);

		int MaxWorkerCount = 0;

		std::mutex Mutex;

		std::condition_variable WorkAvailable;

		std::condition_variable WorkCompleted;

		std::vector<std::thread> Workers;

		// 아래 작업 상태는 Mutex 아래에서만 읽고 씁니다. 완료 대기가 끝나면 대여를 해제합니다.
		const void* JobContext = nullptr;

		FRangeFunction JobFunction = nullptr;

		int JobBirdCount = 0;

		int JobRangeCount = 0;

		int PendingWorkerCount = 0;

		std::uint64_t JobGeneration = 0;

		bool bStopping = false;
#endif
	};
} // namespace boids
