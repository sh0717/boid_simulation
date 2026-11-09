#include "simulation/BirdUpdateExecutor.h"

#include <algorithm>

FBirdUpdateExecutor::FBirdUpdateExecutor(int RequestedWorkerThreadLimit)
	: Executor(static_cast<std::size_t>(std::clamp(RequestedWorkerThreadLimit, 0, static_cast<int>(FParallelExecutor::DefaultWorkerCount()))))
{
}

int FBirdUpdateExecutor::GetLastExecutionWorkerCount() const
{
	return static_cast<int>(Executor.GetLastExecutionWorkerCount());
}
