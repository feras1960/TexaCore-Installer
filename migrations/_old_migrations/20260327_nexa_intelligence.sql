-- ═══════════════════════════════════════════════════════
-- 🧠 NexaIntelligence — Database Schema
-- وكيل TexaCore الذكي للتقارير والمهام والتحليلات
-- ═══════════════════════════════════════════════════════

-- ═══ 1. التقارير اليومية ═══
CREATE TABLE IF NOT EXISTS ai_daily_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    report_type TEXT NOT NULL CHECK (report_type IN ('morning','evening')),
    report_date DATE NOT NULL,
    full_analysis JSONB NOT NULL DEFAULT '{}',
    employee_reports JSONB DEFAULT '{}',
    manager_summary TEXT,
    pdf_url TEXT,
    voice_url TEXT,
    model_used TEXT DEFAULT 'claude-opus',
    tokens_used INTEGER DEFAULT 0,
    cost_usd DECIMAL(10,4) DEFAULT 0,
    generated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(company_id, report_type, report_date)
);

-- ═══ 2. المهام الذكية ═══
CREATE TABLE IF NOT EXISTS ai_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    assigned_to UUID REFERENCES user_profiles(id),
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),
    category TEXT CHECK (category IN ('sales','collection','inventory','purchase','accounting','delivery','hr','general')),
    due_date DATE NOT NULL,
    due_time TIME,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','cancelled','overdue')),
    completed_at TIMESTAMPTZ,
    created_by_ai BOOLEAN DEFAULT true,
    ai_reasoning TEXT,
    related_entity_type TEXT,
    related_entity_id UUID,
    result_notes TEXT,
    proof_image_url TEXT,
    proof_signature_url TEXT,
    overdue_notified BOOLEAN DEFAULT false,
    points_earned INTEGER DEFAULT 0,
    report_id UUID REFERENCES ai_daily_reports(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ═══ 3. إعدادات Telegram ═══
CREATE TABLE IF NOT EXISTS telegram_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    telegram_chat_id TEXT NOT NULL,
    telegram_username TEXT,
    is_active BOOLEAN DEFAULT true,
    notify_morning BOOLEAN DEFAULT true,
    notify_evening BOOLEAN DEFAULT true,
    notify_tasks BOOLEAN DEFAULT true,
    notify_alerts BOOLEAN DEFAULT true,
    notify_voice BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, company_id)
);

-- ═══ 4. استخدام Claude اليومي ═══
CREATE TABLE IF NOT EXISTS ai_opus_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
    reports_generated INTEGER DEFAULT 0,
    tokens_used INTEGER DEFAULT 0,
    cost_usd DECIMAL(10,4) DEFAULT 0,
    UNIQUE(company_id, usage_date)
);

-- ═══ 5. Gamification — نقاط الموظفين ═══
CREATE TABLE IF NOT EXISTS employee_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    points INTEGER DEFAULT 0,
    period_type TEXT DEFAULT 'monthly' CHECK (period_type IN ('daily','weekly','monthly')),
    period_date DATE NOT NULL,
    category TEXT,
    reason TEXT,
    task_id UUID REFERENCES ai_tasks(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══ 6. KPIs — مؤشرات الأداء ═══
CREATE TABLE IF NOT EXISTS employee_kpis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    kpi_date DATE NOT NULL DEFAULT CURRENT_DATE,
    invoices_created INTEGER DEFAULT 0,
    invoices_target INTEGER DEFAULT 5,
    collections_amount DECIMAL(15,2) DEFAULT 0,
    collections_target DECIMAL(15,2) DEFAULT 0,
    tasks_completed INTEGER DEFAULT 0,
    tasks_total INTEGER DEFAULT 0,
    task_completion_rate DECIMAL(5,2) DEFAULT 0,
    avg_response_time_hours DECIMAL(8,2),
    points_earned INTEGER DEFAULT 0,
    rank_in_team INTEGER,
    ai_performance_note TEXT,
    UNIQUE(company_id, user_id, kpi_date)
);

-- ═══ 7. التنبيهات الفورية ═══
CREATE TABLE IF NOT EXISTS ai_realtime_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    alert_type TEXT NOT NULL CHECK (alert_type IN ('low_stock','overdue_invoice','large_payment','container_arrival','task_overdue','target_achieved')),
    severity TEXT DEFAULT 'medium' CHECK (severity IN ('critical','high','medium','low')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    target_users UUID[] DEFAULT '{}',
    target_roles TEXT[] DEFAULT '{}',
    related_entity_type TEXT,
    related_entity_id UUID,
    is_read BOOLEAN DEFAULT false,
    sent_telegram BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════
-- 📇 Indexes
-- ═══════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_ai_tasks_company ON ai_tasks(company_id);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_assigned ON ai_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_status ON ai_tasks(status);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_due_date ON ai_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_company_status ON ai_tasks(company_id, status);

CREATE INDEX IF NOT EXISTS idx_ai_reports_company ON ai_daily_reports(company_id);
CREATE INDEX IF NOT EXISTS idx_ai_reports_date ON ai_daily_reports(report_date);

CREATE INDEX IF NOT EXISTS idx_telegram_user ON telegram_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_company ON telegram_settings(company_id);

CREATE INDEX IF NOT EXISTS idx_employee_points_user ON employee_points(user_id, period_date);
CREATE INDEX IF NOT EXISTS idx_employee_kpis_user ON employee_kpis(user_id, kpi_date);

CREATE INDEX IF NOT EXISTS idx_ai_alerts_company ON ai_realtime_alerts(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_alerts_unread ON ai_realtime_alerts(company_id, is_read);

-- ═══════════════════════════════════════════
-- 🔒 RLS Policies
-- ═══════════════════════════════════════════
ALTER TABLE ai_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_opus_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_kpis ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_realtime_alerts ENABLE ROW LEVEL SECURITY;

-- ai_tasks: users see their own tasks, admins see all company tasks
CREATE POLICY "ai_tasks_select" ON ai_tasks FOR SELECT USING (
    assigned_to = auth.uid()
    OR company_id IN (
        SELECT ura.company_id FROM user_role_assignments ura
        JOIN roles r ON r.id = ura.role_id
        WHERE ura.user_id = auth.uid() AND ura.is_active = true
        AND r.code IN ('super_admin','tenant_owner','company_owner','company_admin')
    )
);
CREATE POLICY "ai_tasks_update" ON ai_tasks FOR UPDATE USING (
    assigned_to = auth.uid()
    OR company_id IN (
        SELECT ura.company_id FROM user_role_assignments ura
        JOIN roles r ON r.id = ura.role_id
        WHERE ura.user_id = auth.uid() AND ura.is_active = true
        AND r.code IN ('super_admin','tenant_owner','company_owner','company_admin')
    )
);
CREATE POLICY "ai_tasks_insert" ON ai_tasks FOR INSERT WITH CHECK (
    company_id IN (
        SELECT company_id FROM user_role_assignments WHERE user_id = auth.uid() AND is_active = true
    )
);

-- ai_daily_reports: admins see all, employees see their own via employee_reports
CREATE POLICY "ai_reports_select" ON ai_daily_reports FOR SELECT USING (
    company_id IN (
        SELECT company_id FROM user_role_assignments WHERE user_id = auth.uid() AND is_active = true
    )
);

-- telegram_settings: users manage their own
CREATE POLICY "telegram_own" ON telegram_settings FOR ALL USING (user_id = auth.uid());

-- ai_opus_usage: admins only
CREATE POLICY "opus_usage_admin" ON ai_opus_usage FOR SELECT USING (
    company_id IN (
        SELECT ura.company_id FROM user_role_assignments ura
        JOIN roles r ON r.id = ura.role_id
        WHERE ura.user_id = auth.uid() AND ura.is_active = true
        AND r.code IN ('super_admin','tenant_owner','company_owner','company_admin')
    )
);

-- employee_points: own points or admin
CREATE POLICY "points_select" ON employee_points FOR SELECT USING (
    user_id = auth.uid()
    OR company_id IN (
        SELECT ura.company_id FROM user_role_assignments ura
        JOIN roles r ON r.id = ura.role_id
        WHERE ura.user_id = auth.uid() AND ura.is_active = true
        AND r.code IN ('super_admin','tenant_owner','company_owner','company_admin')
    )
);

-- employee_kpis: own kpis or admin
CREATE POLICY "kpis_select" ON employee_kpis FOR SELECT USING (
    user_id = auth.uid()
    OR company_id IN (
        SELECT ura.company_id FROM user_role_assignments ura
        JOIN roles r ON r.id = ura.role_id
        WHERE ura.user_id = auth.uid() AND ura.is_active = true
        AND r.code IN ('super_admin','tenant_owner','company_owner','company_admin')
    )
);

-- ai_realtime_alerts: company members
CREATE POLICY "alerts_select" ON ai_realtime_alerts FOR SELECT USING (
    company_id IN (
        SELECT company_id FROM user_role_assignments WHERE user_id = auth.uid() AND is_active = true
    )
);
CREATE POLICY "alerts_update" ON ai_realtime_alerts FOR UPDATE USING (
    company_id IN (
        SELECT company_id FROM user_role_assignments WHERE user_id = auth.uid() AND is_active = true
    )
);

-- ═══════════════════════════════════════════
-- 🔄 Triggers
-- ═══════════════════════════════════════════

-- Auto-update updated_at on ai_tasks
CREATE OR REPLACE FUNCTION update_ai_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ai_tasks_updated_at
    BEFORE UPDATE ON ai_tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_ai_tasks_updated_at();

-- Auto-mark overdue tasks
CREATE OR REPLACE FUNCTION mark_overdue_tasks()
RETURNS void AS $$
BEGIN
    UPDATE ai_tasks
    SET status = 'overdue'
    WHERE status IN ('pending', 'in_progress')
    AND due_date < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- Auto-calculate KPI completion rate
CREATE OR REPLACE FUNCTION update_kpi_completion_rate()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.tasks_total > 0 THEN
        NEW.task_completion_rate = (NEW.tasks_completed::DECIMAL / NEW.tasks_total) * 100;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kpi_completion
    BEFORE INSERT OR UPDATE ON employee_kpis
    FOR EACH ROW
    EXECUTE FUNCTION update_kpi_completion_rate();

-- Service role insert for Edge Functions
CREATE POLICY "ai_tasks_service_insert" ON ai_tasks FOR INSERT WITH CHECK (true);
CREATE POLICY "ai_reports_service_insert" ON ai_daily_reports FOR INSERT WITH CHECK (true);
CREATE POLICY "opus_usage_service" ON ai_opus_usage FOR ALL USING (true);
CREATE POLICY "points_service_insert" ON employee_points FOR INSERT WITH CHECK (true);
CREATE POLICY "kpis_service" ON employee_kpis FOR ALL USING (true);
CREATE POLICY "alerts_service_insert" ON ai_realtime_alerts FOR INSERT WITH CHECK (true);


SELECT 'NexaIntelligence schema created successfully! 🧠' AS result;
