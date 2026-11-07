#pragma once
#include "core/SimulationConstants.h"
#include <algorithm>
#include <cmath>
#include <numbers>

namespace detail
{
	// 시뮬레이션의 판정 허용 오차이며 기계 엡실론과 다릅니다.
	constexpr double Epsilon = 1e-8;
	constexpr double GoalPathPeriod = std::numbers::pi * 2 / constants::GoalPeriodFrequency;

	/** LowerBound 이하와 UpperBound 이상을 제한합니다. 경계 순서와 유한 입력은 호출자가 보장합니다. */
	inline double Clamp(double Value, double LowerBound, double UpperBound)
	{
		return std::max(LowerBound, std::min(UpperBound, Value));
	}

	/** 양수는 1, 음수는 -1, 0은 0을 반환합니다. */
	inline double Sign(double Value)
	{
		return (Value > 0) - (Value < 0);
	}
} // namespace detail
