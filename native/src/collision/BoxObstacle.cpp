#include "collision/BoxObstacle.h"
#include <algorithm>
#include <cmath>

namespace boids
{
	EObstacleShape FBoxObstacle::GetShape() const noexcept
	{
		return EObstacleShape::Box;
	}

	void FBoxObstacle::Configure(const FObstacleDescriptor& Descriptor)
	{
		SetCenter(Descriptor.Center);
		Dimensions = Descriptor.Dimensions;
	}

	double FBoxObstacle::CalculateSignedDistance(const FVector3D& Position, FVector3D& OutNormal) const
	{
		const FVector3D CenterOffset = Position - GetCenter();
		FVector3D SignedFaceDistances;
		FVector3D OutsideDistances;
		for (EAxis Axis : AllAxes)
		{
			SignedFaceDistances[Axis] = std::abs(CenterOffset[Axis]) - Dimensions[Axis] / 2;
			OutsideDistances[Axis] = std::max(SignedFaceDistances[Axis], 0.0);
			OutNormal[Axis] = 0;
		}
		// 바깥에서는 최근접 표면까지의 거리, 내부에서는 가장 가까운 면의 음수 거리를 사용합니다.
		const double OutsideDistance = OutsideDistances.Length();
		if (OutsideDistance > 0)
		{
			for (EAxis Axis : AllAxes)
			{
				OutNormal[Axis] = (CenterOffset[Axis] < 0 ? -OutsideDistances[Axis] : OutsideDistances[Axis]) / OutsideDistance;
			}
			return OutsideDistance;
		}
		EAxis ClosestFaceAxis;
		// 동률의 x, y, z 우선순위를 유지해야 중심과 모서리의 보정 방향이 바뀌지 않습니다.
		if (SignedFaceDistances.X >= SignedFaceDistances.Y && SignedFaceDistances.X >= SignedFaceDistances.Z)
		{
			ClosestFaceAxis = EAxis::X;
		}
		else if (SignedFaceDistances.Y >= SignedFaceDistances.Z)
		{
			ClosestFaceAxis = EAxis::Y;
		}
		else
		{
			ClosestFaceAxis = EAxis::Z;
		}
		OutNormal[ClosestFaceAxis] = CenterOffset[ClosestFaceAxis] < 0 ? -1 : 1;
		return std::max({SignedFaceDistances.X, SignedFaceDistances.Y, SignedFaceDistances.Z});
	}

	double FBoxObstacle::GetAvoidanceFalloffLength(double AvoidanceDistance) const
	{
		return AvoidanceDistance;
	}
} // namespace boids
