'use client';

import { useMemo, useState } from "react";

const workoutTypes = ['Easy Run', 'Long Run', 'Tempo Run', 'Intervals'];
const weatherConditions = ['Hot', 'Mild', 'Cold', 'Rain'];
const intensityLevels = ['Low', 'Moderate', 'High'];

export default function DashboardPage() {
    const [workoutType, setWorkoutType] = useState('');
    const [weatherCondition, setWeatherCondition] = useState('');
    const [intensity, setIntensity] = useState('');
    const [submitted, setSubmitted] = useState(false);

    const canSubmit = useMemo(
        () => Boolean(workoutType && weatherCondition && intensity),
        [workoutType, weatherCondition, intensity],
    )

    const handleGetRecommendations = () => {
        if (!canSubmit) return
        setSubmitted(true)
    }

    return (
        <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-6">
            <header className="space-y-2">
                <h1 className="text-3xl font-semibold">Command Center</h1>
                <p className="text-sm text-gray-600">Complete each step to get recommendations.</p>
            </header>

            <section className="space-y-5 rounded-xl border border-gray-200 p-5 shadow-sm">
            <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="workout-type">
                    1. Select workout type
                </label>
                <select 
                    id="workout-type" 
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2"
                    value={workoutType}
                    onChange={(event) => {
                        setWorkoutType(event.target.value)
                        setSubmitted(false)
                    }}
                >
                    <option value="">Choose a workout</option>
                    {workoutTypes.map((type) => (
                        <option key={type} value={type}>
                            {type}
                        </option>
                    ))}
                </select>
            </div>

            <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="weather-condition">
                    2. Select weather condition
                </label>
                <select 
                    id="weather-condition" 
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2"
                    value={weatherCondition}
                    onChange={(event) => {
                        setWeatherCondition(event.target.value)
                        setSubmitted(false)
                    }}
                >
                    <option value="">Choose weather</option>
                    {weatherConditions.map((condition) => (
                        <option key={condition} value={condition}>
                            {condition}
                        </option>
                    ))}
                </select>
            </div>

            <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="intensity">
                    3. Select intensity
                </label>
                <select 
                    id="intensity" 
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2"
                    value={intensity}
                    onChange={(event) => {
                        setIntensity(event.target.value)
                        setSubmitted(false)
                    }}
                >
                    <option value="">Choose intensity</option>
                    {intensityLevels.map((level) => (
                        <option key={level} value={level}>
                            {level}
                        </option>
                    ))}
                </select>
            </div>

            <button 
                type="button"
                className="rounded-md bg-black px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canSubmit}
                onClick={handleGetRecommendations}
            >
                Get Recommendations
            </button>
        </section>

        {submitted ? (
            <section className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
                Recommendations coming up for {workoutType} in {weatherCondition.toLowerCase()} weather at {intensity.toLowerCase()} intensity.
            </section>
        ) : null}
        </main>
    )
}