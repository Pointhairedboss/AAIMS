import { useState, useEffect, useCallback } from 'react';
import type {
  Solution,
  Capability,
  Control,
  WorkingGroupMember,
  Breach,
  ComplianceAudit,
  BitBopReceipt,
} from './types';
import {
  fetchSolutions,
  createSolution,
  advanceSolutionStage,
  linkCapabilitiesToSolution,
  linkControlsToSolution,
  fetchCapabilities,
  createCapability,
  updateCapabilityStatus,
  linkControlsToCapability,
  fetchControls,
  fetchWorkingGroupMembers,
  fetchBreaches,
  createBreach,
  createRemediation,
  fetchAudits,
  createAudit,
  fetchAttestations,
} from './services/api';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { SolutionsPage } from './pages/SolutionsPage';
import { SolutionDetailPage } from './pages/SolutionDetailPage';
import { CapabilitiesPage } from './pages/CapabilitiesPage';
import { ControlsPage } from './pages/ControlsPage';
import { AttestationsPage } from './pages/AttestationsPage';
import { AuditsPage } from './pages/AuditsPage';

export function App() {
  const [currentTab, setCurrentTab] = useState<string>('solutions');
  const [selectedSolution, setSelectedSolution] = useState<Solution | null>(null);

  // Core Data
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [controls, setControls] = useState<Control[]>([]);
  const [workingGroupMembers, setWorkingGroupMembers] = useState<WorkingGroupMember[]>([]);
  const [breaches, setBreaches] = useState<Breach[]>([]);
  const [audits, setAudits] = useState<ComplianceAudit[]>([]);
  const [attestations, setAttestations] = useState<BitBopReceipt[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [
        solsData,
        capsData,
        ctrlsData,
        wgData,
        breachesData,
        auditsData,
        attsData,
      ] = await Promise.all([
        fetchSolutions().catch(() => []),
        fetchCapabilities().catch(() => []),
        fetchControls().catch(() => []),
        fetchWorkingGroupMembers().catch(() => []),
        fetchBreaches().catch(() => []),
        fetchAudits().catch(() => []),
        fetchAttestations().catch(() => []),
      ]);

      setSolutions(solsData);
      setCapabilities(capsData);
      setControls(ctrlsData);
      setWorkingGroupMembers(wgData);
      setBreaches(breachesData);
      setAudits(auditsData);
      setAttestations(attsData);

      // Keep selectedSolution in sync if one is currently opened
      if (selectedSolution) {
        const fresh = solsData.find((s) => s.id === selectedSolution.id);
        if (fresh) setSelectedSolution(fresh);
      }
    } catch {
      // Graceful fallback without throwing or logging to console.error
    } finally {
      setLoading(false);
    }
  }, [selectedSolution]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle URL hash changes for direct navigation / testing
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace('#', '');
      if (['solutions', 'capabilities', 'controls', 'attestations', 'audits'].includes(hash)) {
        setCurrentTab(hash);
      }
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const handleNavigate = (tab: string) => {
    setCurrentTab(tab);
    window.location.hash = tab;
  };

  const handleSelectSolution = (sol: Solution) => {
    setSelectedSolution(sol);
    setCurrentTab('solution-detail');
  };

  const handleCreateSolution = async (data: {
    title: string;
    business_problem: string;
    requesting_unit: string;
    owner_name: string;
    owner_remit: string;
    risk_tier: string;
  }) => {
    const created = await createSolution(data);
    await loadData();
    return created;
  };

  const handleAdvanceStage = async (targetStage: number, approverName?: string) => {
    if (!selectedSolution) return;
    const updated = await advanceSolutionStage(selectedSolution.id, targetStage, approverName);
    setSelectedSolution(updated);
    await loadData();
  };

  const handleLinkCapabilities = async (capabilityIds: string[]) => {
    if (!selectedSolution) return;
    const updated = await linkCapabilitiesToSolution(selectedSolution.id, capabilityIds);
    setSelectedSolution(updated);
    await loadData();
  };

  const handleLinkControls = async (controlIds: string[]) => {
    if (!selectedSolution) return;
    const updated = await linkControlsToSolution(selectedSolution.id, controlIds);
    setSelectedSolution(updated);
    await loadData();
  };

  const handleCreateCapability = async (data: {
    name: string;
    description: string;
    provider_or_tech: string;
    owner_name: string;
    status: string;
  }) => {
    await createCapability(data);
    await loadData();
  };

  const handleUpdateCapabilityStatus = async (id: string, status: string) => {
    await updateCapabilityStatus(id, status);
    await loadData();
  };

  const handleLinkControlsToCapability = async (id: string, controlIds: string[]) => {
    await linkControlsToCapability(id, controlIds);
    await loadData();
  };

  const handleLogBreach = async (data: {
    title: string;
    severity: string;
    affected_entity_type: string;
    affected_entity_id: string;
    description: string;
    reported_by: string;
  }) => {
    await createBreach(data);
    await loadData();
  };

  const handleSubmitRemediation = async (data: {
    breach_id: string;
    remediation_summary: string;
    verified_by: string;
  }) => {
    await createRemediation(data);
    await loadData();
  };

  const handleExecuteAudit = async (data: {
    audit_name: string;
    auditor_name: string;
    guardrails_evaluated: number[];
    overall_compliance_status: string;
    findings?: string;
  }) => {
    await createAudit(data);
    await loadData();
  };

  return (
    <div className="app-root">
      <Header currentTab={currentTab} onNavigate={handleNavigate} />

      <main className="main-content">
        {loading ? (
          <div style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--text-muted)' }}>
            Loading Australian AI Management & Safety Interface...
          </div>
        ) : (
          <>
            {currentTab === 'solutions' && (
              <SolutionsPage
                solutions={solutions}
                onSelectSolution={handleSelectSolution}
                onCreateSolution={handleCreateSolution}
              />
            )}

            {currentTab === 'solution-detail' && selectedSolution && (
              <SolutionDetailPage
                solution={selectedSolution}
                capabilities={capabilities}
                controls={controls}
                workingGroupMembers={workingGroupMembers}
                breaches={breaches}
                onBack={() => setCurrentTab('solutions')}
                onAdvanceStage={handleAdvanceStage}
                onLinkCapabilities={handleLinkCapabilities}
                onLinkControls={handleLinkControls}
                onLogBreach={handleLogBreach}
                onSubmitRemediation={handleSubmitRemediation}
              />
            )}

            {currentTab === 'capabilities' && (
              <CapabilitiesPage
                capabilities={capabilities}
                controls={controls}
                onCreateCapability={handleCreateCapability}
                onUpdateStatus={handleUpdateCapabilityStatus}
                onLinkControls={handleLinkControlsToCapability}
              />
            )}

            {currentTab === 'controls' && <ControlsPage controls={controls} />}

            {currentTab === 'attestations' && (
              <AttestationsPage attestations={attestations} onRefresh={loadData} />
            )}

            {currentTab === 'audits' && (
              <AuditsPage audits={audits} onExecuteAudit={handleExecuteAudit} />
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}

export default App;
