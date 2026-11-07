#pragma once
#include "core/Vector3D.h"

// 군집 힘과 검사·이웃 수를 소유하는 내부 값 타입이며 C ABI 배열과는 독립입니다.
struct FFlockingResult
{
	// 응집·정렬·분리의 합력이며 목표·포식자·장애물·경계 힘은 별도로 적용합니다.
	FVector3D Force{};

	/** 자신을 제외한 탐색 후보에 거리 검사를 수행한 횟수이며, 실제 이웃 수와 구분합니다. */
	int DistanceCheckCount = 0;

	/** 인지 거리·시야 조건을 통과하여 응집·정렬 계산에 사용한 이웃 수입니다. */
	int VisibleNeighborCount = 0;
};
