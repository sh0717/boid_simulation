#pragma once
#include "collision/Obstacle.h"

namespace boids
{
	// 중심과 반지름을 소유하고 구 표면의 부호 있는 거리와 법선을 계산합니다.
	// 중심과 평가점이 겹치면 기존 규칙에 따라 x 양의 방향을 반환합니다.
	class FSphereObstacle final : public FObstacle
	{
	public:
		EObstacleShape GetShape() const noexcept override;

		/** 설명에서 중심과 반지름을 복사합니다. */
		void Configure(const FObstacleDescriptor& Descriptor) override;

		/** 중심 거리에서 반지름을 뺍니다. 중심 거리가 Epsilon 이하이면 법선은 +X입니다. */
		double CalculateSignedDistance(const FVector3D& Position, FVector3D& OutNormal) const override;

		/** 구 반지름과 회피 거리의 합을 회피 감쇠 길이로 반환합니다. */
		double GetAvoidanceFalloffLength(double AvoidanceDistance) const override;

	private:
		double Radius = 0;
	};
} // namespace boids
