#include "simulation/SpatialGrid.h"
#include <algorithm>
#include <cassert>
#include <cmath>

namespace boids
{
	int FSpatialGrid::GetCellCoordinate(double Value, EAxis Axis) const
	{
		const double LastCellCoordinate = static_cast<double>(AxisCellCounts[ToIndex(Axis)] - 1);
		const double PositionCellCoordinate = std::floor((Value + WorldHalfExtents[Axis]) / CellWidth);
		const double ClampedCellCoordinate = std::max(0.0, std::min(LastCellCoordinate, PositionCellCoordinate));
		return static_cast<int>(ClampedCellCoordinate);
	}

	int FSpatialGrid::GetCellIndex(int X, int Y, int Z) const
	{
		return X + AxisCellCounts[ToIndex(EAxis::X)] * (Y + AxisCellCounts[ToIndex(EAxis::Y)] * Z);
	}

	FSpatialGrid::FCellRange FSpatialGrid::GetQueryCellRange(double Value, EAxis Axis, int CellSearchRadius) const
	{
		const int CenterCell = GetCellCoordinate(Value, Axis);
		return {std::max(0, CenterCell - CellSearchRadius), std::min(AxisCellCounts[ToIndex(Axis)] - 1, CenterCell + CellSearchRadius)};
	}

	double FSpatialGrid::GetCellDistanceLowerBound(double Value, int Cell, EAxis Axis) const
	{
		const double CellStart = Cell * CellWidth - WorldHalfExtents[Axis];
		// Soft 경계의 끝 셀은 맵 밖까지 이어지므로 바깥쪽 거리 하한을 0으로 둡니다.
		const double DistanceBeforeCell = Cell == 0 ? 0 : CellStart - Value;
		const double DistanceAfterCell = Cell == AxisCellCounts[ToIndex(Axis)] - 1 ? 0 : Value - CellStart - CellWidth;
		return std::max({DistanceBeforeCell, 0.0, DistanceAfterCell});
	}

	void FSpatialGrid::Rebuild(const FBirdVectorBuffer& BirdPositions, int BirdCount, const FWorldBounds& Bounds, double NewCellWidth)
	{
		assert(BirdCount >= 0 && BirdCount <= constants::MaxBirdCount);
		assert(BirdPositions.GetBirdCapacity() >= BirdCount);
		CellWidth = NewCellWidth;
		for (EAxis Axis : AllAxes)
		{
			WorldHalfExtents[Axis] = Bounds.HalfExtents[Axis];
			AxisCellCounts[ToIndex(Axis)] = static_cast<int>(std::ceil(WorldHalfExtents[Axis] * 2 / CellWidth));
		}
		const int ActiveCellCount = AxisCellCounts[ToIndex(EAxis::X)] * AxisCellCounts[ToIndex(EAxis::Y)] * AxisCellCounts[ToIndex(EAxis::Z)];
		std::fill_n(CellHeads.begin(), ActiveCellCount, -1);
		for (int BirdIndex = 0; BirdIndex < BirdCount; ++BirdIndex)
		{
			const int CellIndex = GetCellIndex(GetCellCoordinate(BirdPositions.GetComponent(BirdIndex, EAxis::X), EAxis::X), GetCellCoordinate(BirdPositions.GetComponent(BirdIndex, EAxis::Y), EAxis::Y), GetCellCoordinate(BirdPositions.GetComponent(BirdIndex, EAxis::Z), EAxis::Z));
			// 셀의 기존 머리 앞에 삽입하여 별도 개체별 컨테이너 없이 연결 목록을 만듭니다.
			NextBirdIndices[BirdIndex] = CellHeads[CellIndex];
			CellHeads[CellIndex] = BirdIndex;
		}
	}

	void FSpatialGrid::QueryCandidates(const FVector3D& QueryPosition, double QueryRadius, std::vector<int>& OutCandidateIndices) const
	{
		OutCandidateIndices.clear();
		const int CellSearchRadius = static_cast<int>(std::ceil(QueryRadius / CellWidth));
		const FCellRange RangeX = GetQueryCellRange(QueryPosition.X, EAxis::X, CellSearchRadius);
		const FCellRange RangeY = GetQueryCellRange(QueryPosition.Y, EAxis::Y, CellSearchRadius);
		const FCellRange RangeZ = GetQueryCellRange(QueryPosition.Z, EAxis::Z, CellSearchRadius);
		// 셀까지의 거리 하한이 반경 이상이면 셀 전체를 건너뛸 수 있습니다.
		const double QueryRadiusSquared = QueryRadius * QueryRadius;
		for (int CellZ = RangeZ.First; CellZ <= RangeZ.Last; ++CellZ)
		{
			const double DistanceLowerBoundZ = GetCellDistanceLowerBound(QueryPosition.Z, CellZ, EAxis::Z);
			for (int CellY = RangeY.First; CellY <= RangeY.Last; ++CellY)
			{
				const double DistanceLowerBoundY = GetCellDistanceLowerBound(QueryPosition.Y, CellY, EAxis::Y);
				const double DistanceLowerBoundYZSquared = DistanceLowerBoundY * DistanceLowerBoundY + DistanceLowerBoundZ * DistanceLowerBoundZ;
				if (DistanceLowerBoundYZSquared >= QueryRadiusSquared)
				{
					continue;
				}
				for (int CellX = RangeX.First; CellX <= RangeX.Last; ++CellX)
				{
					const double DistanceLowerBoundX = GetCellDistanceLowerBound(QueryPosition.X, CellX, EAxis::X);
					if (DistanceLowerBoundX * DistanceLowerBoundX + DistanceLowerBoundYZSquared >= QueryRadiusSquared)
					{
						continue;
					}
					for (int BirdIndex = CellHeads[GetCellIndex(CellX, CellY, CellZ)]; BirdIndex != -1; BirdIndex = NextBirdIndices[BirdIndex])
					{
						OutCandidateIndices.push_back(BirdIndex);
					}
				}
			}
		}
	}
} // namespace boids
