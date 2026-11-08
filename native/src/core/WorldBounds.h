#pragma once

#include "core/Vector3D.h"

// 원점 중심 월드의 축별 반길이를 소유합니다. 유효 범위는 각 축의 [-HalfExtents, +HalfExtents]입니다.
struct FWorldBounds
{
	FVector3D HalfExtents;
};
