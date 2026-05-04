'use client';

import { useMemo, useState } from "react";

const workoutTypes = ['Easy Run', 'Long Run', 'Tempo Run', 'Intervals'];
const weatherConditions = ['Hot', 'Mild', 'Cold', 'Rain'];
const intensityLevels = ['Low', 'Moderate', 'High'];

function Chip({ label, selected, onClick}: any) {
    return (
        <button 
            type="button" 
            onClick={onClick} 
            className={`px-3 py-1.5 rounded-full text-sm border transition ${selected ? "bg-black text-white border-black" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"}`}
        >
            {label}
        </button>
    )
}

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
                
                {/* Workout */}
                <div className="space-y-2">
                    <p className="text-sm font-semibold">1. Select workout</p>
                    <div className="flex flex-wrap gap-2">
                        {workoutTypes.map((type) => (
                            <Chip 
                                key={type} 
                                label={type} 
                                selected={workoutType === type}
                                onClick={() => {
                                    setWorkoutType(type);
                                    setSubmitted(false);
                                }}
                            />
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <p className="text-sm font-semibold">2. Select weather</p>
                    <div className="flex flex-wrap gap-2">
                        {weatherConditions.map((condition) => (
                            <Chip 
                                key={condition}
                                label={condition}
                                selected={weatherCondition === condition}
                                onClick={() => {
                                    setWeatherCondition(condition);
                                    setSubmitted(false);
                                }}
                            />
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <p className="text-sm font-semibold">3. Select intensity</p>
                    <div className="flex flex-wrap gap-2">
                        {intensityLevels.map((level) => (
                            <Chip
                                key={level}
                                label={level}
                                selected={intensity === level}
                                onClick={() => {
                                    setIntensity(level);
                                    setSubmitted(false);
                                }}
                            />
                        ))}
                    </div>
                </div>

                <button type="button" className="w-full rounded-md bg-black px-2 py-2 font-medium text-white disabled:opacity-50" disabled={!canSubmit} onClick={handleGetRecommendations}>
                    Generate My Fit
                </button>
            </section>

            <section className="rounded-xl border p-4 text-sm">
                {workoutType && weatherCondition && intensity ? (
                    <>
                        <p className="text-gray-500 mb-2">Preview</p>
                        <p className="font-medium">
                            {workoutType} • {weatherCondition} • {intensity}
                        </p>
                        
                        <ul className="mt-3 space-y-1 text-gray-700">
                            <li>Top: Bandit Mircromesh Run Tee</li>
                            <li>Bottom: Nike Aeroswift Running Shorts</li>
                        </ul>
                    </>
                ) : (
                    <p className="text-gray-400">
                        Select options to preview your run outfit
                    </p>
                )}
            </section>
            
            {submitted ? (
                <section className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
                    Recommendations coming up for {workoutType} in {weatherCondition.toLowerCase()} weather at {intensity.toLowerCase()} intensity.
                </section>
            ) : null}
        </main>
    )
}