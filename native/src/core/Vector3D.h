#pragma once

#include "core/Axis.h"
#include "core/SimulationConstants.h"

#include <array>
#include <cmath>

// double 계산용 값이며 EAxis로 축을 구분합니다. 연산은 성분별 원래 순서로 수행합니다.
struct FVector3D
{
	double X = 0;

	double Y = 0;

	double Z = 0;

	/** 연속한 float XYZ 세 값을 double 벡터로 읽습니다. 포인터와 원소 범위는 호출자가 보장합니다. */
	static FVector3D Load(const float* Values)
	{
		return {static_cast<double>(Values[0]), static_cast<double>(Values[1]), static_cast<double>(Values[2])};
	}

	double& operator[](EAxis Axis)
	{
		if (Axis == EAxis::X)
		{
			return X;
		}

		if (Axis == EAxis::Y)
		{
			return Y;
		}

		return Z;
	}

	const double& operator[](EAxis Axis) const
	{
		if (Axis == EAxis::X)
		{
			return X;
		}

		if (Axis == EAxis::Y)
		{
			return Y;
		}

		return Z;
	}

	FVector3D operator+(const FVector3D& Other) const
	{
		return {X + Other.X, Y + Other.Y, Z + Other.Z};
	}

	FVector3D operator-(const FVector3D& Other) const
	{
		return {X - Other.X, Y - Other.Y, Z - Other.Z};
	}

	FVector3D operator-() const
	{
		return {-X, -Y, -Z};
	}

	FVector3D operator*(double Scalar) const
	{
		return {X * Scalar, Y * Scalar, Z * Scalar};
	}

	FVector3D operator/(double Scalar) const
	{
		return {X / Scalar, Y / Scalar, Z / Scalar};
	}

	FVector3D& operator+=(const FVector3D& Other)
	{
		X += Other.X;
		Y += Other.Y;
		Z += Other.Z;

		return *this;
	}

	FVector3D& operator-=(const FVector3D& Other)
	{
		X -= Other.X;
		Y -= Other.Y;
		Z -= Other.Z;

		return *this;
	}

	FVector3D& operator*=(double Scalar)
	{
		X *= Scalar;
		Y *= Scalar;
		Z *= Scalar;

		return *this;
	}

	FVector3D& operator/=(double Scalar)
	{
		X /= Scalar;
		Y /= Scalar;
		Z /= Scalar;

		return *this;
	}

	/** std::hypot으로 벡터 길이를 계산합니다. */
	double Length() const
	{
		return std::hypot(X, Y, Z);
	}

	/** 제곱근 없이 길이의 제곱을 계산합니다. 항의 누적 순서는 X → Y → Z입니다. */
	double LengthSquared() const
	{
		return X * X + Y * Y + Z * Z;
	}

	/** 성분별 곱을 X → Y → Z 순서로 더해 내적을 계산합니다. */
	double Dot(const FVector3D& Other) const
	{
		return X * Other.X + Y * Other.Y + Z * Other.Z;
	}
};

inline FVector3D operator*(double Scalar, const FVector3D& Vector)
{
	return {Scalar * Vector.X, Scalar * Vector.Y, Scalar * Vector.Z};
}

// float32 저장 배열을 소유하며 GetData 포인터는 객체 생존 중 같은 버퍼를 가리킵니다.
// EAxis로 축을 구분하며 double 변환과 float 저장은 호출 지점에서 명시합니다.
struct FVector3f
{
	std::array<float, constants::AxisCount> Components{};

	float* GetData()
	{
		return Components.data();
	}

	const float* GetData() const
	{
		return Components.data();
	}

	float& operator[](EAxis Axis)
	{
		return Components[ToIndex(Axis)];
	}

	const float& operator[](EAxis Axis) const
	{
		return Components[ToIndex(Axis)];
	}

	/** float 저장소의 XYZ를 독립된 double 벡터 값으로 변환합니다. */
	FVector3D ToDouble() const
	{
		return FVector3D::Load(Components.data());
	}

	void Store(const FVector3D& Value)
	{
		for (EAxis Axis : AllAxes)
		{
			Components[ToIndex(Axis)] = static_cast<float>(Value[Axis]);
		}
	}
};
