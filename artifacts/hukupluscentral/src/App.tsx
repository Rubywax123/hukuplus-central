import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthGuard } from "@/components/layout";

// Pages
import DashboardPage from "@/pages/dashboard";
import RetailersPage from "@/pages/retailers";
import AgreementsPage from "@/pages/agreements";
import TeamPage from "@/pages/team";
import PublicSigningPage from "@/pages/public-signing";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      {/* Public Unauthenticated Zone */}
      <Route path="/sign/:token">
        {params => <PublicSigningPage token={params.token} />}
      </Route>
      
      {/* Internal Authenticated Zone */}
      <Route path="*">
        <AuthGuard>
          <Switch>
            <Route path="/" component={DashboardPage} />
            <Route path="/retailers" component={RetailersPage} />
            <Route path="/agreements" component={AgreementsPage} />
            <Route path="/team" component={TeamPage} />
            <Route component={NotFound} />
          </Switch>
        </AuthGuard>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
