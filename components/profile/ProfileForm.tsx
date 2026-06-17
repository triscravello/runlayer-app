"use client";

import { useEffect, useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch, type FieldError, type FieldPath } from "react-hook-form";
import { useAuth } from "@/context/authContext";
import { useProfile } from "@/hooks/useProfile";
import type { UserProfile } from "@/lib/types/user";
import {
  bodyTypeSchema,
  budgetLevelSchema,
  budgetSensitivitySchema,
  coldToleranceSchema,
  genderPreferenceSchema,
  heatSensitivitySchema,
  heatToleranceSchema,
  preferredFitSchema,
  profileSchema,
  stylePreferenceSchema,
  terrainPreferenceSchema,
  type UserProfilePayload
} from "@/lib/validation/profileSchema";
import { Button } from "../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";

type SelectOption<T extends string = string> = { value: T; label: string };

type ProfileFormState = {
  heightCm: string;
  weightLbs: string;
  bodyType: "" | NonNullable<UserProfilePayload["bodyType"]>;
  genderPreference: "" | NonNullable<UserProfilePayload["genderPreference"]>;
  preferredFit: UserProfilePayload["preferredFit"];
  heatSensitivity: UserProfilePayload["heatSensitivity"];
  heatTolerance: UserProfilePayload["heatTolerance"];
  coldTolerance: UserProfilePayload["coldTolerance"];
  chafeProne: boolean;
  stylePreference: UserProfilePayload["stylePreference"];
  budgetLevel: UserProfilePayload["budgetLevel"];
  budgetSensitivity: UserProfilePayload["budgetSensitivity"];
  terrainPreference: UserProfilePayload["terrainPreference"];
  preferredBrands: string;
  avoidedBrands: string;
};

const bodyTypeOptions: SelectOption<ProfileFormState["bodyType"]>[] = [
  { value: "", label: "Select body type" },
  { value: "SLIM", label: "Slim" },
  { value: "ATHLETIC", label: "Athletic" },
  { value: "BROAD", label: "Broad" },
  { value: "PLUS", label: "Plus" },
];

const genderPreferenceOptions: SelectOption<ProfileFormState["genderPreference"]>[] = [
  { value: "", label: "No preference" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

const preferredFitOptions: SelectOption<UserProfilePayload["preferredFit"]>[] = [
  { value: "slim", label: "Slim" },
  { value: "regular", label: "Regular" },
  { value: "relaxed", label: "Relaxed" },
];

const toleranceOptions: SelectOption<UserProfilePayload["heatTolerance"]>[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const stylePreferenceOptions: SelectOption<UserProfilePayload["stylePreference"]>[] = [
  { value: "performance", label: "Performance" },
  { value: "casual", label: "Casual" },
  { value: "minimal", label: "Minimal" },
  { value: "bold", label: "Bold" },
  { value: "classic", label: "Classic" },
];

const budgetLevelOptions: SelectOption<UserProfilePayload["budgetLevel"]>[] = [
  { value: "BUDGET", label: "Low" },
  { value: "MID", label: "Mid" },
  { value: "PREMIUM", label: "High" },
];

const budgetSensitivityOptions: SelectOption<UserProfilePayload["budgetSensitivity"]>[] = toleranceOptions;
const terrainPreferenceOptions: SelectOption<UserProfilePayload["terrainPreference"]>[] = [
  { value: "mixed", label: "Mixed" },
  { value: "road", label: "Road" },
  { value: "trail", label: "Trail" },
];

const selectClassName =
  "border-input bg-input-background focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full rounded-md border px-3 py-1 text-base outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

const initialFormState: ProfileFormState = {
  heightCm: "",
  weightLbs: "",
  bodyType: "",
  genderPreference: "",
  preferredFit: "regular",
  heatSensitivity: "medium",
  heatTolerance: "medium",
  coldTolerance: "medium",
  chafeProne: false,
  stylePreference: "performance",
  budgetLevel: "MID",
  budgetSensitivity: "medium",
  terrainPreference: "mixed",
  preferredBrands: "",
  avoidedBrands: "",
};

function enumValue<T extends string>(schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }, value: string | null | undefined, fallback: T): T {
  const result = schema.safeParse(value);
  return result.success && result.data ? result.data : fallback;
}

function optionalBodyType(value: string | null | undefined): ProfileFormState["bodyType"] {
  const result = bodyTypeSchema.safeParse(value);
  return result.success ? result.data : "";
}

function optionalGenderPreference(value: string | null | undefined): ProfileFormState["genderPreference"] {
  const result = genderPreferenceSchema.safeParse(value);
  return result.success ? result.data : "";
}

function createFormState(profile: UserProfile | null): ProfileFormState {
  if (!profile) return initialFormState;

  return {
    heightCm: profile.heightCm?.toString() ?? "",
    weightLbs: profile.weightLbs?.toString() ?? "",
    bodyType: optionalBodyType(profile.bodyType),
    genderPreference: optionalGenderPreference(profile.genderPreference),
    preferredFit: enumValue(preferredFitSchema, profile.preferredFit, "regular"),
    heatSensitivity: enumValue(heatSensitivitySchema, profile.heatSensitivity, "medium"),
    heatTolerance: enumValue(heatToleranceSchema, profile.heatTolerance, "medium"),
    coldTolerance: enumValue(coldToleranceSchema, profile.coldTolerance, "medium"),
    chafeProne: profile.chafeProne,
    stylePreference: enumValue(stylePreferenceSchema, profile.stylePreference, "performance"),
    budgetLevel: enumValue(budgetLevelSchema, profile.budgetLevel, "MID"),
    budgetSensitivity: enumValue(budgetSensitivitySchema, profile.budgetSensitivity, "medium"),
    terrainPreference: enumValue(terrainPreferenceSchema, profile.terrainPreference, "mixed"),
    preferredBrands: profile.preferredBrands?.join(", ") ?? "",
    avoidedBrands: profile.avoidedBrands?.join(", ") ?? "",
  }
}

function convertCentimetersToFeetAndInches(heightCm: string) {
  const centimeters = Number(heightCm);

  if (!Number.isFinite(centimeters) || centimeters <= 0) return "Enter height in centimeters to see feet and inches.";
  
  const totalInches = Math.round(centimeters / 2.54);

  return `${Math.floor(totalInches / 12)} ft ${totalInches % 12} in`;
}

function FieldErrorMessage({ error }: { error?: FieldError }) {
  return error?.message ? <p className="text-xs text-red-600">{error.message}</p> : null;
}

export default function ProfileForm() {
  const { user, loading: authLoading } = useAuth();
  const { profile, isLoading, isSaving, error, successMessage, saveProfile } = useProfile(user?.id);
  const userExists = Boolean(user);

  const {
    formState: { errors, isDirty, isValid },
    handleSubmit,
    register,
    reset,
    control,
  } = useForm<ProfileFormState, UserProfilePayload>({
    defaultValues: initialFormState,
    mode: "onChange",
    resolver: zodResolver(profileSchema),
  });

  useEffect(() => {
    reset(userExists ? createFormState(profile) : initialFormState);
  }, [profile, reset, userExists]);

  const heightCm = useWatch({ control, name: "heightCm" });
  const convertedHeight = useMemo(() => convertCentimetersToFeetAndInches(heightCm), [heightCm]);
  const isDisabled = authLoading || isLoading || isSaving || !userExists;
  const saveDisabled = isDisabled || !isDirty || !isValid;

  const onSubmit = handleSubmit(async (payload: UserProfilePayload) => {
    const nextProfile = await saveProfile(payload);

    if (nextProfile) reset(createFormState(nextProfile));
  });

  const errorFor = (name: FieldPath<ProfileFormState>) => errors[name] as FieldError | undefined;

  return (
    <Card className="border-2 border-[#10B981]/15 shadow-lg">
      <CardHeader>
        <CardTitle className="text-2xl">Profile Preferences</CardTitle>
        <CardDescription>Tell RunLayer how your gear should feel, fit, and match your running style.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-8">
          {!userExists && !authLoading ? <p className="rounded-lg bg-muted/60 px-4 py-3 text-sm text-muted-foreground">Log in to save your profile preferences.</p> : null}
          {error ? <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p> : null}
          {successMessage ? <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</p> : null}

          <section className="space-y-4">
            <div>
              <h2>Body & Fit</h2>
              <p className="text-sm text-muted-foreground">Capture your core fit profile so recommendations can prioritize the right cuts and sizes.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="heightCm">Height (cm)</Label>
                <Input id="heightCm" min="0" inputMode="numeric" type="number" {...register("heightCm")} placeholder="178" disabled={isDisabled} />
                <p className="text-xs text-muted-foreground">{convertedHeight}</p>
                <FieldErrorMessage error={errorFor("heightCm")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="weightLbs">Weight (lbs)</Label>
                <Input id="weightLbs" min="0" inputMode="numeric" type="number" {...register("weightLbs")} placeholder="165" disabled={isDisabled} />
                <FieldErrorMessage error={errorFor("weightLbs")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bodyType">Body Type</Label>
                <select id="bodyType" className={selectClassName} {...register("bodyType")} disabled={isDisabled}>{bodyTypeOptions.map((option) => <option key={option.value || option.label} value={option.value}>{option.label}</option>)}</select>
                <FieldErrorMessage error={errorFor("bodyType")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="genderPreference">Gender</Label>
                <select id="genderPreference" className={selectClassName} {...register("genderPreference")} disabled={isDisabled}>{genderPreferenceOptions.map((option) => <option key={option.value || option.label} value={option.value}>{option.label}</option>)}</select>
                <FieldErrorMessage error={errorFor("genderPreference")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="preferredFit">Preferred Fit</Label>
                <select id="preferredFit" className={selectClassName} {...register("preferredFit")} disabled={isDisabled}>{preferredFitOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                <FieldErrorMessage error={errorFor("preferredFit")} />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h2>Comfort Profile</h2>
              <p className="text-sm text-muted-foreground">Tune recommendations for temperature response and friction risk.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {(["heatSensitivity", "heatTolerance", "coldTolerance"] as const).map((field) => <div key={field} className="space-y-2"><Label htmlFor={field}>{field === "heatSensitivity" ? "Heat Sensitivity" : field === "heatTolerance" ? "Heat Tolerance" : "Cold Tolerance"}</Label><select id={field} className={selectClassName} {...register(field)} disabled={isDisabled}>{toleranceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><FieldErrorMessage error={errorFor(field)} /></div>)}
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3"><input id="chafeProne" type="checkbox" className="size-4 rounded border-input accent-[#10B981]" {...register("chafeProne")} disabled={isDisabled} /><div className="space-y-1"><Label htmlFor="chafeProne">Chafe Prone</Label><p className="text-xs text-muted-foreground">Prioritize smoother seams, liners, and anti-chafe materials.</p></div></div>
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h2>Style & Budget</h2>
              <p className="text-sm text-muted-foreground">Balance the look and price point of your outfit recommendations.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="stylePreference">Style Preference</Label><select id="stylePreference" className={selectClassName} {...register("stylePreference")} disabled={isDisabled}>{stylePreferenceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><FieldErrorMessage error={errorFor("stylePreference")} /></div>
              <div className="space-y-2"><Label htmlFor="budgetLevel">Budget Level</Label><select id="budgetLevel" className={selectClassName} {...register("budgetLevel")} disabled={isDisabled}>{budgetLevelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><FieldErrorMessage error={errorFor("budgetLevel")} /></div>
              <div className="space-y-2"><Label htmlFor="budgetSensitivity">Budget Sensitivity</Label><select id="budgetSensitivity" className={selectClassName} {...register("budgetSensitivity")} disabled={isDisabled}>{budgetSensitivityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><FieldErrorMessage error={errorFor("budgetSensitivity")} /></div>
              <div className="space-y-2"><Label htmlFor="terrainPreference">Terrain Preference</Label><select id="terrainPreference" className={selectClassName} {...register("terrainPreference")} disabled={isDisabled}>{terrainPreferenceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><FieldErrorMessage error={errorFor("terrainPreference")} /></div>
              <div className="space-y-2"><Label htmlFor="preferredBrands">Preferred Brands</Label><Input id="preferredBrands" {...register("preferredBrands")} placeholder="Nike, Tracksmith" disabled={isDisabled} /><FieldErrorMessage error={errorFor("preferredBrands")} /></div>
              <div className="space-y-2 md:col-span-2"><Label htmlFor="avoidedBrands">Avoided Brands</Label><Input id="avoidedBrands" {...register("avoidedBrands")} placeholder="Brands to down-rank" disabled={isDisabled} /><FieldErrorMessage error={errorFor("avoidedBrands")} /></div>
            </div>
          </section>

          <div className="flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-muted-foreground">{isLoading ? "Loading saved profile..." : "Your preferences update future outfit recommendations."}</p><Button type="submit" disabled={saveDisabled} className="bg-[#10B981] text-white hover:bg-[#059669]">{isSaving ? "Saving..." : "Save Profile"}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}