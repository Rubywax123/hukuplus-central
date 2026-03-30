import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthGuard } from "@/components/layout";
import { LoanAppProvider } from "@/contexts/LoanAppContext";

// Pages
import DashboardPage from "@/pages/dashboard";
import RetailersPage from "@/pages/retailers";
import AgreementsPage from "@/pages/agreements";
import LoanAppsPage from "@/pages/loan-apps";
import TeamPage from "@/pages/team";
import PublicSigningPage from "@/pages/public-signing";
import KioskPage from "@/pages/kiosk";
import PortalLoginPage from "@/pages/portal-login";
import PortalDashboardPage from "@/pages/portal-dashboard";
import ExecutionCertificatePage from "@/pages/execution-certificate";
import CustomersPage from "@/pages/customers";
import ApplicationsPage from "@/pages/applications";
import ApplyHukuPlusPage from "@/pages/apply-hukuplus";
import ApplyRevolverPage from "@/pages/apply-revolver";
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

      {/* Public Kiosk — no auth required */}
      <Route path="/kiosk/:branchId">
        {params => <KioskPage branchId={params.branchId!} />}
      </Route>

      {/* Public Customer Application Forms — no auth required */}
      <Route path="/apply/hukuplus" component={ApplyHukuPlusPage} />
      <Route path="/apply/revolver" component={ApplyRevolverPage} />

      {/* Retailer Portal Zone (own auth) */}
      <Route path="/portal/login" component={PortalLoginPage} />
      <Route path="/portal/dashboard" component={PortalDashboardPage} />
      <Route path="/portal">
        {() => { window.location.replace("/portal/login"); return null; }}
      </Route>

      {/* Standalone — accessible to portal users and admins, no admin chrome */}
      <Route path="/agreements/:id/execution">
        {params => <ExecutionCertificatePage agreementId={params.id!} />}
      </Route>

      {/* Internal Authenticated Zone */}
      <Route path="*">
        <AuthGuard>
          <Switch>
            <Route path="/" component={DashboardPage} />
            <Route path="/retailers" component={RetailersPage} />
            <Route path="/agreements" component={AgreementsPage} />
            <Route path="/loan-apps" component={LoanAppsPage} />
            <Route path="/customers" component={CustomersPage} />
            <Route path="/applications" component={ApplicationsPage} />
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
        <LoanAppProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </LoanAppProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
