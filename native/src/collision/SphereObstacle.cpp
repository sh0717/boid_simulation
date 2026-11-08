#include "collision/SphereObstacle.h"
#include "core/MathUtils.h"

EObstacleShape FSphereObstacle::GetShape() const noexcept
{
	return EObstacleShape::Sphere;
}

void FSphereObstacle::Configure(const FObstacleDescriptor& Descriptor)
{
	SetCenter(Descriptor.Center);
	Radius = Descriptor.Radius;
}

double FSphereObstacle::CalculateSignedDistance(const FVector3D& Position, FVector3D& OutNormal) const
{
	const FVector3D CenterOffset = Position - GetCenter();
	const double CenterDistance = CenterOffset.Length();

	// 중심 근처에서는 방향을 정할 수 없으므로 +X를 대체 법선으로 사용합니다.
	for (EAxis Axis : AllAxes)
	{
		OutNormal[Axis] = CenterDistance > detail::Epsilon ? CenterOffset[Axis] / CenterDistance : (Axis == EAxis::X ? 1 : 0);
	}

	return CenterDistance - Radius;
}

double FSphereObstacle::GetAvoidanceFalloffLength(double AvoidanceDistance) const
{
	return Radius + AvoidanceDistance;
}
