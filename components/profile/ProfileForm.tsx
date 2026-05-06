"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/context/authContext";
import { useProfile } from "@/hooks/useProfile";
import type { UserProfilePayload } from "@/lib/types/user";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";

type SelectOption = {
  value: string;
  label: string;
};

const bodyTypeOptions: SelectOption[] = [
  { value: "", label: "Select body type" },
  { value: "SLIM", label: "Slim" },
  { value: "ATHLETIC", label: "Athletic" },
  { value: "BROAD", label: "Broad" },
  { value: "PLUS", label: "Plus" },
];

const preferredFitOptions: SelectOption[] = [
  { value: "slim", label: "Slim" },
  { value: "regular", label: "Regular" },
  { value: "relaxed", label: "Relaxed" },
];

const heatSensitivityOptions: SelectOption[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const stylePreferenceOptions: SelectOption[] = [
  { value: "performance", label: "Performance" },
  { value: "casual", label: "Casual" },
  { value: "minimal", label: "Minimal" },
  { value: "bold", label: "Bold" },
  { value: "classic", label: "Classic" },
];

const budgetLevelOptions: SelectOption[] = [
  { value: "BUDGET", label: "Low" },
  { value: "MID", label: "Mid" },
  { value: "PREMIUM", label: "High" },
];

const selectClassName =
  "border-input bg-input-background focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full rounded-md border px-3 py-1 text-base outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

const initialFormState = {
  heightCm: "",
  weightLbs: "",
  bodyType: "",
  preferredFit: "regular",
  heatSensitivity: "medium",
  chafeProne: false,
  stylePreference: "performance",
  budgetLevel: "MID",
};

type ProfileFormState = typeof initialFormState;

function createFormState(profile: {
  heightCm?: number | null;
  weightLbs?: number | null;
  bodyType?: string | null;
  preferredFit?: string | null;
  heatSensitivity?: string | null;
  chafeProne: boolean;
  stylePreference?: string | null;
  budgetLevel?: string | null;
} | null): ProfileFormState {
  if (!profile) {
    return initialFormState;
  }

  return {
    heightCm: profile.heightCm?.toString() ?? "",
    weightLbs: profile.weightLbs?.toString() ?? "",
    bodyType: profile.bodyType ?? "",
    preferredFit: profile.preferredFit ?? "regular",
    heatSensitivity: profile.heatSensitivity ?? "medium",
    chafeProne: profile.chafeProne,
    stylePreference: profile.stylePreference ?? "performance",
    budgetLevel: profile.budgetLevel ?? "MID",
  };
}

function convertCentimetersToFeetAndInches(heightCm: string) {
  const centimeters = Number(heightCm);

  if (!Number.isFinite(centimeters) || centimeters <= 0) {
    return "Enter height in centimeters to see feet and inches.";
  }

  const totalInches = Math.round(centimeters / 2.54);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;

  return `${feet} ft ${inches} in`;
}

function toOptionalNumber(value: string) {
  if (!value.trim()) {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

type ProfileFormFieldsProps = {
  authLoading: boolean;
  error: string;
  isLoading: boolean;
  isSaving: boolean;
  profile: ReturnType<typeof useProfile>["profile"];
  saveProfile: ReturnType<typeof useProfile>["saveProfile"];
  successMessage: string;
  userExists: boolean;
};

function ProfileFormFields({
  authLoading,
  error,
  isLoading,
  isSaving,
  profile,
  saveProfile,
  successMessage,
  userExists,
}: ProfileFormFieldsProps) {
  const [formState, setFormState] = useState(() => createFormState(profile));

  const convertedHeight = useMemo(
    () => convertCentimetersToFeetAndInches(formState.heightCm),
    [formState.heightCm],
  );

  const handleFieldChange = (field: keyof ProfileFormState, value: string | boolean) => {
    setFormState((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload: UserProfilePayload = {
      heightCm: toOptionalNumber(formState.heightCm),
      weightLbs: toOptionalNumber(formState.weightLbs),
      bodyType: formState.bodyType || undefined,
      preferredFit: formState.preferredFit,
      heatSensitivity: formState.heatSensitivity,
      chafeProne: formState.chafeProne,
      stylePreference: formState.stylePreference,
      budgetLevel: formState.budgetLevel,
    };

    await saveProfile(payload);
  };

  const isDisabled = authLoading || isLoading || isSaving || !userExists;

  return (
    <Card className="border-2 border-[#10B981]/15 shadow-lg">
      <CardHeader>
        <CardTitle className="text-2xl">Profile Preferences</CardTitle>
        <CardDescription>
          Tell RunLayer how your gear should feel, fit, and match your running style.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-8">
          {!userExists && !authLoading ? (
            <p className="rounded-lg bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
              Log in to save your profile preferences.
            </p>
          ) : null}

          {error ? <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p> : null}
          {successMessage ? (
            <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</p>
          ) : null}

          <section className="space-y-4">
            <div>
              <h2>Body & Fit</h2>
              <p className="text-sm text-muted-foreground">
                Capture your core fit profile so recommendations can prioritize the right cuts and sizes.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="heightCm">Height (cm)</Label>
                <Input
                  id="heightCm"
                  min="0"
                  inputMode="numeric"
                  type="number"
                  value={formState.heightCm}
                  onChange={(event) => handleFieldChange("heightCm", event.target.value)}
                  placeholder="178"
                  disabled={isDisabled}
                />
                <p className="text-xs text-muted-foreground">{convertedHeight}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="weightLbs">Weight (lbs)</Label>
                <Input
                  id="weightLbs"
                  min="0"
                  inputMode="numeric"
                  type="number"
                  value={formState.weightLbs}
                  onChange={(event) => handleFieldChange("weightLbs", event.target.value)}
                  placeholder="165"
                  disabled={isDisabled}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="bodyType">Body Type</Label>
                <select
                  id="bodyType"
                  className={selectClassName}
                  value={formState.bodyType}
                  onChange={(event) => handleFieldChange("bodyType", event.target.value)}
                  disabled={isDisabled}
                >
                  {bodyTypeOptions.map((option) => (
                    <option key={option.value || option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="preferredFit">Preferred Fit</Label>
                <select
                  id="preferredFit"
                  className={selectClassName}
                  value={formState.preferredFit}
                  onChange={(event) => handleFieldChange("preferredFit", event.target.value)}
                  disabled={isDisabled}
                >
                  {preferredFitOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h2>Comfort Profile</h2>
              <p className="text-sm text-muted-foreground">
                Tune recommendations for temperature response and friction risk.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="heatSensitivity">Heat Sensitivity</Label>
                <select
                  id="heatSensitivity"
                  className={selectClassName}
                  value={formState.heatSensitivity}
                  onChange={(event) => handleFieldChange("heatSensitivity", event.target.value)}
                  disabled={isDisabled}
                >
                  {heatSensitivityOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
                <input
                  id="chafeProne"
                  type="checkbox"
                  className="size-4 rounded border-input accent-[#10B981]"
                  checked={formState.chafeProne}
                  onChange={(event) => handleFieldChange("chafeProne", event.target.checked)}
                  disabled={isDisabled}
                />
                <div className="space-y-1">
                  <Label htmlFor="chafeProne">Chafe Prone</Label>
                  <p className="text-xs text-muted-foreground">
                    Prioritize smoother seams, liners, and anti-chafe materials.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h2>Style & Budget</h2>
              <p className="text-sm text-muted-foreground">
                Balance the look and price point of your outfit recommendations.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="stylePreference">Style Preference</Label>
                <select
                  id="stylePreference"
                  className={selectClassName}
                  value={formState.stylePreference}
                  onChange={(event) => handleFieldChange("stylePreference", event.target.value)}
                  disabled={isDisabled}
                >
                  {stylePreferenceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="budgetLevel">Budget Level</Label>
                <select
                  id="budgetLevel"
                  className={selectClassName}
                  value={formState.budgetLevel}
                  onChange={(event) => handleFieldChange("budgetLevel", event.target.value)}
                  disabled={isDisabled}
                >
                  {budgetLevelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {isLoading ? "Loading saved profile..." : "Your preferences update future outfit recommendations."}
            </p>
            <Button
              type="submit"
              disabled={isDisabled}
              className="bg-[#10B981] text-white hover:bg-[#059669]"
            >
              {isSaving ? "Saving..." : "Save Profile"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
export default function ProfileForm() {
  const { user, loading: authLoading } = useAuth();
  const { profile, isLoading, isSaving, error, successMessage, saveProfile } = useProfile(user?.id);

  return (
    <ProfileFormFields
      key={profile?.updatedAt ?? profile?.id ?? "new-profile"}
      authLoading={authLoading}
      error={error}
      isLoading={isLoading}
      isSaving={isSaving}
      profile={profile}
      saveProfile={saveProfile}
      successMessage={successMessage}
      userExists={Boolean(user)}
    />
  );
}