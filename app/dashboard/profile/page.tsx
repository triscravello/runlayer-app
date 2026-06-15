import ProfileForm from "@/components/profile/ProfileForm";

export const metadata = {
    title: "Runner Profile | RunLayer",
    description: "Configure your body, comfort, style, and budget preferences for personalized running gear recommendations.",
};

export default function ProfilePage() {
    return (
        <main className="min-h-screen bg-background p-4 md:p-8">
            <div className="mx-auto max-w-4xl space-y-6">
                <div className="space-y-2">
                    <h1 className="text-3xl font-semibold">Runner Profile</h1>
                    <p className="text-muted-foreground">
                        Configure your body, comfort, style, and budget preferences for personalized recommendations.
                    </p>
                </div>

                <ProfileForm />
            </div>
        </main>
    );
}