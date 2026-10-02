import AppRouter from "../routing/AppRouter.jsx";
import AppBootstrapProvider from "./AppBootstrapProvider.jsx";
import AuthProvider from "../auth/AuthProvider.jsx";

export default function App() {
  return (
    <AuthProvider>
      <AppBootstrapProvider>
        <AppRouter />
      </AppBootstrapProvider>
    </AuthProvider>
  );
}
