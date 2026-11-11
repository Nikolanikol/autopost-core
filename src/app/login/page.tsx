import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div style={{ maxWidth: 360, margin: "48px auto" }}>
      <h1>Вход</h1>
      <LoginForm next={next ?? "/"} />
    </div>
  );
}
