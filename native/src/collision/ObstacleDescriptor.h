#pragma once

#include "core/Vector3D.h"

#include <array>
#include <boids/boids.h>

enum class EObstacleShape : int
{
	Sphere = 0,
	Box = 1
};

// ABI 레코드와 분리된 장애물 값이며 Dimensions는 상자의 축별 전체 길이입니다.
struct FObstacleDescriptor
{
	// Shape에 따라 Radius 또는 Dimensions를 사용하며 Center는 두 형상에 공통입니다.
	EObstacleShape Shape = EObstacleShape::Sphere;

	FVector3D Center;

	double Radius = 0;

	FVector3D Dimensions;
};

// 활성 범위의 장애물 설명을 값으로 소유하며 원본 ABI 배열을 빌리지 않습니다.
struct FObstacleDescriptorSnapshot
{
	std::array<FObstacleDescriptor, MaxObstacles> Descriptors{};

	int ActiveObstacleCount = 0;
};
