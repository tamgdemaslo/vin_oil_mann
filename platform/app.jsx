// ====================================================================
//  platform/app.jsx — router + mount
// ====================================================================

function useHashRoute() {
  const parse = () => window.location.hash.replace(/^#/, '') || '/home';
  const [path, setPath] = useState(parse());

  useEffect(() => {
    const onHash = () => { setPath(parse()); window.scrollTo({top: 0, behavior: 'instant'}); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (to) => { window.location.hash = to; };

  const segs = path.split('/').filter(Boolean);
  const params = {};
  if (segs[0] === 'shipments' && segs[1] && segs[1] !== 'new') params.id = segs[1];
  if (segs[0] === 'crm' && segs[1]) params.id = segs[1];
  if (segs[0] === 'diagnostics' && segs[1]) params.id = segs[1];
  if (segs[0] === 'diag-print' && segs[1]) params.id = segs[1];

  return { path, go, params };
}

function App() {
  const router = useHashRoute();
  const seg = router.path.split('/').filter(Boolean);
  const first = seg[0];
  const second = seg[1];

  let page;
  if (router.path === '/login' || router.path === '/locked') page = <LoginScreen />;
  else if (first === 'home' || !first) page = <HomeScreen />;
  else if (first === 'shipments' && second === 'new') page = <NewShipmentScreen />;
  else if (first === 'shipments' && second) page = <ShipmentDetailScreen />;
  else if (first === 'shipments') page = <ShipmentsListScreen />;
  else if (first === 'cash') page = <CashScreen />;
  else if (first === 'products') page = <ProductsScreen />;
  else if (first === 'receiving') page = <ReceivingScreen />;
  else if (first === 'writeoff') page = <WriteoffScreen />;
  else if (first === 'restock') page = <RestockScreen />;
  else if (first === 'invoices') page = <SupplierInvoicesScreen />;
  else if (first === 'profit') page = <ProfitScreen />;
  else if (first === 'deals') page = <DealsListScreen />;
  else if (first === 'crm' && second) page = <DealDetailScreen />;
  else if (first === 'crm') page = <CrmKanbanScreen />;
  else if (first === 'journal') page = <JournalScreen />;
  else if (first === 'diagnostics') page = <DiagnosticsScreen />;
  else if (first === 'diag-print') page = <DiagnosticsPrintCard />;
  else if (first === 'payroll') page = <PayrollScreen />;
  else page = <HomeScreen />;

  return (
    <RouterCtx.Provider value={router}>
      <TopBar />
      {page}
    </RouterCtx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
