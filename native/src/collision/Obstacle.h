#pragma once

#include "collision/ObstacleDescriptor.h"

// 장애물 중심을 소유하고 거리·법선과 회피 여유 거리의 공통 계약을 정의합니다.
// 파생 객체는 FObstacleSet이 고유 소유하며 기본 포인터로 안전하게 삭제할 수 있습니다.
class FObstacle
{
public:
	virtual ~FObstacle() = default;

	virtual EObstacleShape GetShape() const noexcept = 0;

	/** 검증된 형상 설명을 소유 값에 반영합니다. 레코드나 참조를 보관하지 않습니다. */
	virtual void Configure(const FObstacleDescriptor& Descriptor) = 0;

	/** 표면까지의 부호 있는 거리(내부 음수·외부 양수)를 반환하고 바깥 방향 단위 법선을 기록합니다. */
	virtual double CalculateSignedDistance(const FVector3D& Position, FVector3D& OutNormal) const = 0;

	// 회피 힘 감쇠를 정규화할 길이이며 부호 있는 표면 거리와 구분합니다.
	virtual double GetAvoidanceFalloffLength(double AvoidanceDistance) const = 0;

protected:
	FObstacle() = default;

	void SetCenter(const FVector3D& InCenter)
	{
		Center = InCenter;
	}

	const FVector3D& GetCenter() const
	{
		return Center;
	}

private:
	FVector3D Center;
};
