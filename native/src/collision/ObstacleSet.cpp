#include "collision/ObstacleSet.h"
#include "collision/BoxObstacle.h"
#include "collision/SphereObstacle.h"
#include <cassert>

namespace boids
{
	namespace
	{
		std::unique_ptr<FObstacle> CreateObstacle(EObstacleShape Shape)
		{
			if (Shape == EObstacleShape::Sphere)
			{
				return std::make_unique<FSphereObstacle>();
			}
			return std::make_unique<FBoxObstacle>();
		}
	} // namespace

	FObstacleSet::FObstacleSet()
	{
		OwnedObstacles.reserve(MaxObstacles);
	}

	void FObstacleSet::Synchronize(const FObstacleDescriptorSnapshot& Snapshot)
	{
		assert(Snapshot.ActiveObstacleCount >= 0 && Snapshot.ActiveObstacleCount <= MaxObstacles);
		OwnedObstacles.resize(static_cast<std::size_t>(Snapshot.ActiveObstacleCount));
		for (int ObstacleIndex = 0; ObstacleIndex < Snapshot.ActiveObstacleCount; ++ObstacleIndex)
		{
			const FObstacleDescriptor& Descriptor = Snapshot.Descriptors[ObstacleIndex];
			std::unique_ptr<FObstacle>& Obstacle = OwnedObstacles[ObstacleIndex];
			// 같은 형상은 객체를 유지하며 값만 갱신합니다. 형태 변경 때만 대여 참조가 무효화됩니다.
			if (!Obstacle || Obstacle->GetShape() != Descriptor.Shape)
			{
				Obstacle = CreateObstacle(Descriptor.Shape);
			}
			Obstacle->Configure(Descriptor);
		}
	}

	int FObstacleSet::GetActiveObstacleCount() const
	{
		return static_cast<int>(OwnedObstacles.size());
	}

	const FObstacle& FObstacleSet::GetObstacle(int ObstacleIndex) const
	{
		assert(ObstacleIndex >= 0 && ObstacleIndex < GetActiveObstacleCount());
		return *OwnedObstacles[ObstacleIndex];
	}
} // namespace boids
