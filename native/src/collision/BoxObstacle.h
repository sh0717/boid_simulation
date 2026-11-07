#pragma once
#include "collision/Obstacle.h"

// 중심과 축별 전체 길이를 소유하고 축 정렬 상자의 거리와 법선을 계산합니다.
// 내부 면의 거리가 같으면 x, y, z 순서로 선택합니다.
class FBoxObstacle final : public FObstacle
{
public:
	EObstacleShape GetShape() const noexcept override;

	/** 설명에서 중심과 축별 전체 길이를 복사합니다. */
	void Configure(const FObstacleDescriptor& Descriptor) override;

	/** 외부에서는 최근접 표면까지, 내부에서는 가장 가까운 면까지의 부호 있는 거리와 법선을 계산합니다. */
	double CalculateSignedDistance(const FVector3D& Position, FVector3D& OutNormal) const override;

	/** 상자의 회피 감쇠 길이로 전달받은 회피 거리를 반환합니다. */
	double GetAvoidanceFalloffLength(double AvoidanceDistance) const override;

private:
	FVector3D Dimensions;
};
