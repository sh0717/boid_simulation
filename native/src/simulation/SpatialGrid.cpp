#include "simulation/SpatialGrid.h"
#include <algorithm>
#include <cassert>
#include <cmath>

int FSpatialGrid::CalculateClampedCellCoordinate(double PositionOnAxis, EAxis Axis) const
{
	const double LastCellCoordinate = static_cast<double>(CellCountByAxis[ToIndex(Axis)] - 1);
	const double PositionCellCoordinate = std::floor((PositionOnAxis + GridHalfExtents[Axis]) / CellWidth);
	const double ClampedCellCoordinate = std::max(0.0, std::min(LastCellCoordinate, PositionCellCoordinate));
	return static_cast<int>(ClampedCellCoordinate);
}

int FSpatialGrid::FlattenCellCoordinates(int CellX, int CellY, int CellZ) const
{
	return CellX + CellCountByAxis[ToIndex(EAxis::X)] * (CellY + CellCountByAxis[ToIndex(EAxis::Y)] * CellZ);
}

FSpatialGrid::FCellRange FSpatialGrid::CalculateQueryCellRange(double PositionOnAxis, EAxis Axis, int SearchRadiusInCells) const
{
	const int CenterCellCoordinate = CalculateClampedCellCoordinate(PositionOnAxis, Axis);
	return {std::max(0, CenterCellCoordinate - SearchRadiusInCells), std::min(CellCountByAxis[ToIndex(Axis)] - 1, CenterCellCoordinate + SearchRadiusInCells)};
}

double FSpatialGrid::CalculateCellAxisDistanceLowerBound(double PositionOnAxis, int CellCoordinate, EAxis Axis) const
{
	const double CellStartCoordinate = CellCoordinate * CellWidth - GridHalfExtents[Axis];
	// Soft 경계의 끝 셀은 맵 밖까지 이어지므로 바깥쪽 거리 하한을 0으로 둡니다.
	const double DistanceBeforeCell = CellCoordinate == 0 ? 0 : CellStartCoordinate - PositionOnAxis;
	const double DistanceAfterCell = CellCoordinate == CellCountByAxis[ToIndex(Axis)] - 1 ? 0 : PositionOnAxis - CellStartCoordinate - CellWidth;
	return std::max({DistanceBeforeCell, 0.0, DistanceAfterCell});
}

void FSpatialGrid::Rebuild(const FBirdVectorBuffer& BirdPositions, int BirdCount, const FWorldBounds& Bounds, double RequestedCellWidth)
{
	assert(BirdCount >= 0 && BirdCount <= constants::MaxBirdCount);
	assert(BirdPositions.GetBirdCapacity() >= BirdCount);
	CellWidth = RequestedCellWidth;
	for (EAxis Axis : AllAxes)
	{
		GridHalfExtents[Axis] = Bounds.HalfExtents[Axis];
		CellCountByAxis[ToIndex(Axis)] = static_cast<int>(std::ceil(GridHalfExtents[Axis] * 2 / CellWidth));
	}
	const int ActiveCellCount = CellCountByAxis[ToIndex(EAxis::X)] * CellCountByAxis[ToIndex(EAxis::Y)] * CellCountByAxis[ToIndex(EAxis::Z)];
	std::fill_n(FirstBirdIndexByCell.begin(), ActiveCellCount, -1);
	for (int BirdIndex = 0; BirdIndex < BirdCount; ++BirdIndex)
	{
		const int CellX = CalculateClampedCellCoordinate(BirdPositions.GetComponent(BirdIndex, EAxis::X), EAxis::X);
		const int CellY = CalculateClampedCellCoordinate(BirdPositions.GetComponent(BirdIndex, EAxis::Y), EAxis::Y);
		const int CellZ = CalculateClampedCellCoordinate(BirdPositions.GetComponent(BirdIndex, EAxis::Z), EAxis::Z);
		const int CellIndex = FlattenCellCoordinates(CellX, CellY, CellZ);
		// 셀의 기존 머리 앞에 삽입하여 별도 개체별 컨테이너 없이 연결 목록을 만듭니다.
		NextBirdIndexByBird[BirdIndex] = FirstBirdIndexByCell[CellIndex];
		FirstBirdIndexByCell[CellIndex] = BirdIndex;
	}
}

void FSpatialGrid::QueryCandidates(const FVector3D& QueryPosition, double QueryRadius, std::vector<int>& OutCandidateIndices) const
{
	OutCandidateIndices.clear();
	const int SearchRadiusInCells = static_cast<int>(std::ceil(QueryRadius / CellWidth));
	const FCellRange RangeX = CalculateQueryCellRange(QueryPosition.X, EAxis::X, SearchRadiusInCells);
	const FCellRange RangeY = CalculateQueryCellRange(QueryPosition.Y, EAxis::Y, SearchRadiusInCells);
	const FCellRange RangeZ = CalculateQueryCellRange(QueryPosition.Z, EAxis::Z, SearchRadiusInCells);
	// Z → Y → X 순으로 셀을 방문합니다. 거리 하한이 반경 이상인 셀 전체를 건너뜁니다.
	const double QueryRadiusSquared = QueryRadius * QueryRadius;
	for (int CellZ = RangeZ.FirstCellCoordinate; CellZ <= RangeZ.LastCellCoordinate; ++CellZ)
	{
		const double DistanceLowerBoundZ = CalculateCellAxisDistanceLowerBound(QueryPosition.Z, CellZ, EAxis::Z);
		for (int CellY = RangeY.FirstCellCoordinate; CellY <= RangeY.LastCellCoordinate; ++CellY)
		{
			const double DistanceLowerBoundY = CalculateCellAxisDistanceLowerBound(QueryPosition.Y, CellY, EAxis::Y);
			const double DistanceLowerBoundYZSquared = DistanceLowerBoundY * DistanceLowerBoundY + DistanceLowerBoundZ * DistanceLowerBoundZ;
			if (DistanceLowerBoundYZSquared >= QueryRadiusSquared)
			{
				continue;
			}
			for (int CellX = RangeX.FirstCellCoordinate; CellX <= RangeX.LastCellCoordinate; ++CellX)
			{
				const double DistanceLowerBoundX = CalculateCellAxisDistanceLowerBound(QueryPosition.X, CellX, EAxis::X);
				if (DistanceLowerBoundX * DistanceLowerBoundX + DistanceLowerBoundYZSquared >= QueryRadiusSquared)
				{
					continue;
				}
				const int CellIndex = FlattenCellCoordinates(CellX, CellY, CellZ);
				for (int BirdIndex = FirstBirdIndexByCell[CellIndex]; BirdIndex != -1; BirdIndex = NextBirdIndexByBird[BirdIndex])
				{
					OutCandidateIndices.push_back(BirdIndex);
				}
			}
		}
	}
}
