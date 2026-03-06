# 🔐 User Access Guide - Benefits AI Assistant

**Last Updated**: October 31, 2025  
**Version**: 3.1.0  
**Status**: Production-Ready

---

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Employee Features](#employee-features)
3. [Admin Features](#admin-features)
4. [User Credentials](#user-credentials)
5. [Feature Walkthroughs](#feature-walkthroughs)
6. [Troubleshooting](#troubleshooting)

---

## 🚀 Quick Start

### Access the Application

**Production URL**: `https://benefits.yourdomain.com`  
**Local Development**: `http://localhost:8080` (after running `npm run dev`)

### Login Process

1. Navigate to the application URL
2. Click "Sign In" or go to `/login`
3. Enter your email and password
4. Complete MFA verification (if enabled)
5. You'll be redirected to your role-specific dashboard

---

## 👤 Employee Features

### Default Test Credentials
```
Email: employee@amerivet.com
Password: amerivet2024!
```

### 1. 🤖 AI Chat Assistant

**Location**: `/(chat)` or `/chat`

**Description**: Ask questions about your benefits and get instant AI-powered answers using GPT-4.

**Features**:
- ✅ **Real-time Streaming Responses**: See answers appear as they're generated
- ✅ **3-Tier Intelligence**:
  - L1 (Fast): Keyword search for common questions (< 500ms)
  - L2 (Accurate): Semantic understanding with vector search (< 2s)
  - L3 (Expert): Deep reasoning for complex scenarios (< 5s)
- ✅ **Conversation History**: Review past conversations
- ✅ **File Attachments**: Upload documents (PDF, DOCX, CSV) for context
- ✅ **Markdown Support**: Formatted responses with tables, lists, code blocks
- ✅ **Citation Tracking**: See which documents the AI used to answer
- ✅ **Suggested Actions**: Quick buttons for common questions

**Example Questions**:
- "What is my medical deductible?"
- "How much does dental coverage cost?"
- "Can I add my spouse to my plan mid-year?"
- "What's covered under vision insurance?"
- "How do I file a claim?"

**How to Use**:
1. Click the chat icon or navigate to the home page
2. Type your question in the input box
3. Press Enter or click Send
4. Wait for the AI response (usually < 2 seconds)
5. Click citations to view source documents
6. Rate the response (1-5 stars) for quality feedback

---

### 2. 💰 Benefits Calculator

**Location**: `/cost-calculator`

**Description**: Interactive calculator to estimate your benefits costs and savings based on different coverage options.

**Features**:
- ✅ **Interactive Sliders**: Adjust coverage levels, deductibles, family size
- ✅ **Real-time Calculations**: See costs update instantly
- ✅ **Employer Contribution Breakdown**: Understand what you pay vs. employer
- ✅ **Annual vs. Monthly View**: Toggle between time periods
- ✅ **Multiple Plan Comparison**: Compare Starter, Professional, Enterprise tiers
- ✅ **Tax Savings Estimation**: Pre-tax benefit calculations
- ✅ **Export Options**: Download results (future enhancement)

**Available Calculators**:
1. **Medical Coverage**: Deductible, copay, coinsurance
2. **Dental Coverage**: Preventive, basic, major services
3. **Vision Coverage**: Frames, lenses, contacts
4. **FSA/HSA**: Flexible spending accounts
5. **Life Insurance**: Coverage amounts and premiums

**How to Use**:
1. Navigate to `/cost-calculator`
2. Select your benefit type (Medical, Dental, Vision, etc.)
3. Use sliders to adjust:
   - Coverage level (Bronze, Silver, Gold, Platinum)
   - Deductible amount
   - Family size (1, 2, 3, 4+)
   - Additional options (HSA, FSA)
4. View results:
   - Monthly premium
   - Annual cost
   - Employer contribution
   - Your out-of-pocket cost
   - Tax savings
5. Compare multiple scenarios side-by-side
6. Click "Save Calculation" to keep for reference

---

### 3. 📄 Document Center

**Location**: `/benefits` or `/company-admin/documents` (view-only for employees)

**Description**: Access all benefit-related documents, policies, and guides.

**Features**:
- ✅ **Searchable Library**: Find documents by keyword
- ✅ **Category Filters**: Medical, Dental, Vision, Policies, FAQs, Guides
- ✅ **Document Preview**: View PDFs inline without downloading
- ✅ **Version History**: See previous versions of updated documents
- ✅ **Bookmarks**: Save frequently accessed documents
- ✅ **Responsive Viewer**: Works on mobile and desktop

**Document Types**:
1. **Benefit Plan Summaries**: Overview of coverage options
2. **Policy Documents**: Official plan terms and conditions
3. **FAQ Documents**: Common questions and answers
4. **Enrollment Guides**: Step-by-step enrollment instructions
5. **Provider Networks**: List of in-network doctors/facilities
6. **Claim Forms**: Downloadable forms for filing claims

**How to Use**:
1. Navigate to `/benefits` or click "Documents" in sidebar
2. Use search bar to find specific documents
3. Filter by category (Medical, Dental, Vision, etc.)
4. Click a document to view details
5. Click "View" to preview in browser
6. Click "Download" to save locally
7. Click bookmark icon to save to favorites

---

### 4. 📊 Plan Comparison

**Location**: `/benefits/compare`

**Description**: Side-by-side comparison of different benefit plans to help you choose the best option.

**Features**:
- ✅ **Interactive Comparison Table**: Compare up to 3 plans simultaneously
- ✅ **Key Metrics Highlighted**: Deductible, out-of-pocket max, premium, copays
- ✅ **Coverage Details**: In-network vs. out-of-network benefits
- ✅ **Cost Estimates**: Annual cost projections based on usage
- ✅ **Recommendation Engine**: AI suggests best plan for your situation
- ✅ **Print-Friendly**: Export comparison as PDF

**Comparison Categories**:
1. **Monthly Premiums**: Employee and employer contributions
2. **Deductibles**: Individual and family
3. **Out-of-Pocket Maximums**: Annual spending limits
4. **Copays**: Doctor visits, specialists, urgent care, ER
5. **Coinsurance**: Percentage after deductible
6. **Prescription Coverage**: Tiers and copays
7. **Additional Benefits**: Wellness programs, telehealth, etc.

**How to Use**:
1. Navigate to `/benefits/compare`
2. Select 2-3 plans to compare (e.g., Gold PPO vs. Silver HMO)
3. Review side-by-side comparison table
4. Click "Estimate Annual Cost" to see projections
5. Input your expected usage:
   - Doctor visits per year
   - Prescriptions per month
   - Expected procedures
6. View AI recommendation based on your profile
7. Click "Enroll in This Plan" to proceed (during open enrollment)

---

### 5. 📱 Responsive Design

**Description**: The application works seamlessly on all devices - desktop, tablet, and mobile.

**Features**:
- ✅ **Mobile-First Design**: Optimized for small screens
- ✅ **Touch-Friendly**: Large buttons and swipe gestures
- ✅ **Adaptive Layout**: Automatically adjusts to screen size
- ✅ **Fast Loading**: Optimized for mobile networks
- ✅ **Offline Support**: View cached content without internet
- ✅ **PWA Ready**: Install as app on mobile devices (future)

**Supported Devices**:
- 📱 **Mobile**: iOS 14+, Android 10+
- 📱 **Tablet**: iPad, Android tablets
- 💻 **Desktop**: Windows, macOS, Linux (Chrome, Firefox, Safari, Edge)

**How to Access on Mobile**:
1. Open your mobile browser (Safari, Chrome)
2. Navigate to the application URL
3. Add to home screen (optional):
   - iOS: Tap Share → Add to Home Screen
   - Android: Tap Menu → Add to Home Screen
4. Access all features optimized for mobile:
   - Swipe to navigate conversations
   - Tap to expand/collapse sections
   - Pinch to zoom on documents

---

### 6. 📈 Dashboard

**Location**: `/` (home page after login)

**Description**: Personalized dashboard showing your benefit status and quick actions.

**Widgets**:
- ✅ **Enrollment Status**: Progress indicator (Not Started, In Progress, Completed)
- ✅ **Recent Conversations**: Last 5 chat interactions
- ✅ **Quick Actions**: Buttons for common tasks
- ✅ **Important Dates**: Open enrollment, deadlines, plan year changes
- ✅ **Notifications**: Alerts for pending actions or updates
- ✅ **Benefit Summary**: Current plan selections and costs

**Quick Actions**:
- 💬 Ask a Question
- 💰 Calculate Costs
- 📄 View Documents
- 📊 Compare Plans
- ✅ Complete Enrollment

---

## 👨‍💼 Admin Features

### Default Test Credentials
```
Email: admin@amerivet.com
Password: admin2024!
```

**Admin Types**:
1. **HR Admin**: View-only analytics, limited document access
2. **Company Admin**: Full company management, employee oversight
3. **Super Admin**: Platform-wide access, multi-company management

---

### 1. 📊 Real-time Analytics Dashboard

**Location**: 
- Company Admin: `/company-admin` or `/admin`
- Super Admin: `/super-admin/analytics`

**Description**: Live usage metrics and performance data with interactive visualizations.

**Available Dashboards**:

#### A. **Quality Metrics Dashboard** (`/analytics/quality-metrics`)

**KPI Cards**:
- Total Conversations (daily, weekly, monthly)
- Average Response Time (by tier L1/L2/L3)
- Average Grounding Score (0-100 accuracy)
- First Contact Resolution Rate (% resolved without escalation)

**Tabs**:

**1. Performance**
- Response Time Trends (bar chart, last 7 days)
- Cache Hit Rate (percentage, real-time)
- Latency Percentiles (P50, P95, P99)

**2. Quality**
- Grounding Score Distribution (pie chart: Excellent/Good/Poor)
- Escalation Rate by Tier (bar chart)
- Confidence Score Trends (line chart)

**3. Satisfaction**
- CSAT Distribution (pie chart: 1-5 stars)
- NPS Score (pie chart: Promoters/Passives/Detractors)
- Feedback Tags (top 10 tags with counts)

**4. Tier Analysis**
- L1 vs. L2 vs. L3 Performance (dual-axis chart)
- Average Response Time by Tier (bar chart)
- Cost per Tier (stacked bar chart)

**Refresh**: Auto-refreshes every 30 seconds

---

#### B. **Observability Dashboard** (`/analytics/observability`)

**KPI Cards**:
- Total Requests (last hour)
- Average Latency (milliseconds)
- Total Cost (USD, daily)
- Cache Hit Rate (percentage)

**Tabs**:

**1. Requests**
- Request Distribution by Tier (bar chart)
- Cache Performance (hits vs. misses)
- Request Rate over Time (line chart)

**2. Latency**
- Latency Percentiles (P50/P95/P99, bar chart)
- Component Breakdown (horizontal bar: retrieval, generation, validation)
- Latency Trends (line chart, last 24 hours)

**3. Cost**
- Cost by Tier (bar chart with pricing)
- Daily Cost Trends (area chart)
- Cost per Conversation (average)

**4. Quality**
- Grounding Score Distribution (histogram)
- Error Rate (percentage, real-time)
- Validation Failures (count by type)

**Refresh**: Auto-refreshes every 15 seconds

---

#### C. **Executive Dashboard** (`/analytics/executive`)

**KPI Cards** (Top Row):
- Total Conversations (7d/30d/90d selectable)
- Average Satisfaction (CSAT + NPS combined)
- Cost per Conversation (USD)
- Resolution Rate (%)
- Cache Hit Rate (%)

**Tabs**:

**1. Trends**
- Conversation Volume (area chart, daily aggregates)
- Satisfaction Trends (line chart, CSAT + NPS over time)
- Cost Trends (bar chart, daily spending)

**2. Topics**
- Top 10 Discussion Topics (horizontal bar chart with counts)
- Topic Distribution (pie chart)
- Trending Topics (list with % change)

**3. Performance**
- Average Latency by Tier (bar chart)
- Quality Score Distribution (histogram)
- Error Rate Trends (line chart)

**Export Options**:
- 📥 **Export to CSV**: Download data for Excel
- 📥 **Export to JSON**: Download for API integration

**Time Ranges**: 7 days, 30 days, 90 days

---

### 2. ✏️ Content Management System (CMS)

**Location**: `/company-admin/documents` or `/admin/documents/upload`

**Description**: Manage FAQs, benefit documents, and content with a rich text editor.

**Features**:
- ✅ **TipTap Rich Text Editor**: WYSIWYG editing experience
- ✅ **Formatting Tools**: Bold, italic, headings, lists, links, images, tables
- ✅ **Document Templates**: Pre-built templates for common document types
- ✅ **Version Control**: Track all changes with rollback capability
- ✅ **AI Indexing**: Automatic embedding generation for search
- ✅ **Processing Status**: See when documents are ready for AI retrieval

**Toolbar Features**:
- **Text Formatting**: Bold, italic, strikethrough
- **Headings**: H1, H2, H3
- **Lists**: Bullet points, numbered lists
- **Links**: Insert hyperlinks
- **Images**: Upload and embed images
- **Tables**: Create structured data tables
- **Blockquotes**: Highlight important sections
- **Undo/Redo**: Revert changes

**Document Templates**:

**1. Benefit Plan Summary**
```html
<h1>Benefit Plan Summary</h1>
<h2>Plan Overview</h2>
<p>Coverage details...</p>
<h2>Costs</h2>
<table>
  <tr><th>Coverage Type</th><th>Employee Cost</th><th>Employer Contribution</th></tr>
  <tr><td>Medical</td><td>$150/month</td><td>$350/month</td></tr>
</table>
```

**2. Policy Document**
```html
<h1>Company Policy</h1>
<h2>1. Purpose</h2>
<p>This policy establishes...</p>
<h2>2. Procedures</h2>
<ol>
  <li>Step one</li>
  <li>Step two</li>
</ol>
```

**3. FAQ Document**
```html
<h1>Frequently Asked Questions</h1>
<h3>Q: How do I enroll?</h3>
<p>A: You can enroll during...</p>
```

**How to Use**:

**Create New Document**:
1. Navigate to `/admin/documents/upload`
2. Click "Create New Document"
3. Choose a template or start blank
4. Enter document title
5. Select document type (Policy, Benefit Plan, FAQ, Guide)
6. Use the rich text editor to create content:
   - Format text with toolbar buttons
   - Insert tables for cost breakdowns
   - Add images for visual aids
   - Create lists for procedures
7. Add metadata:
   - Category (Medical, Dental, Vision, etc.)
   - Tags (for search optimization)
   - Author
8. Click "Save" to create version 1
9. AI will automatically process for search indexing (takes 1-2 minutes)

**Edit Existing Document**:
1. Navigate to `/admin/documents`
2. Find the document in the list
3. Click "Edit"
4. Make changes in the editor
5. Add a description of changes in the modal
6. Click "Save" to increment version (e.g., v1 → v2)
7. Version history is automatically tracked

**View Version History**:
1. Open document details
2. Click "Version History" tab
3. See all versions with:
   - Version number
   - Timestamp
   - User who made changes
   - Description of changes
4. Click "View" to see snapshot
5. Click "Rollback" to revert to that version

**Document Processing Status**:
- **Pending**: Waiting to be processed
- **Processing**: AI is generating embeddings (1-2 min)
- **Ready**: Available for AI search retrieval
- **Failed**: Error occurred (check logs)

---

### 3. 💵 Cost Monitoring

**Location**: `/super-admin/analytics` or `/company-admin` (Cost tab)

**Description**: Track spending on AI usage and set budget alerts.

**Features**:
- ✅ **Real-time Cost Tracking**: See costs as they accrue
- ✅ **Budget Alerts**: Email notifications when thresholds reached
- ✅ **Cost Breakdown by Tier**: L1/L2/L3 usage costs
- ✅ **Company-level Reporting**: Costs per company (super admin)
- ✅ **Daily/Monthly Aggregates**: Historical cost trends
- ✅ **Export Reports**: Download cost data for finance

**Cost Metrics**:
- **Total Daily Cost**: USD spent on AI calls today
- **Cost per Conversation**: Average cost per user interaction
- **Cost by Tier**:
  - L1 (Keyword): ~$0.001 per query
  - L2 (Semantic): ~$0.01 per query
  - L3 (Expert): ~$0.05 per query
- **Monthly Projection**: Estimated month-end total
- **Budget Utilization**: % of monthly budget used

**Cost Alerts**:
1. **Daily Threshold**: Alert when daily cost > $X
2. **Monthly Budget**: Alert at 80%, 90%, 100% of budget
3. **Spike Detection**: Alert on unusual cost increases (> 50% vs. avg)
4. **Per-Company Limits**: Company-specific budgets (super admin)

**How to Configure Alerts**:
1. Navigate to `/super-admin/analytics` → Cost tab
2. Click "Configure Alerts"
3. Set thresholds:
   - Daily limit (e.g., $100)
   - Monthly budget (e.g., $2,000)
   - Alert recipients (email addresses)
4. Choose notification method: Email, Slack, PagerDuty
5. Click "Save Alert Settings"
6. Receive notifications when thresholds breached

**Cost Optimization Tips**:
- Monitor L3 tier usage (most expensive)
- Improve L1 cache hit rate (60%+ target)
- Review high-cost conversations (outliers)
- Optimize document chunking (reduce tokens)

---

### 4. ⭐ Conversation Quality Scoring

**Location**: `/admin` or `/company-admin` → Quality Metrics Dashboard

**Description**: Monitor AI response quality with automated scoring and manual review.

**Quality Metrics**:

**1. Grounding Score** (0-100)
- Measures how well the AI response is supported by retrieved documents
- **Excellent**: 80-100 (high confidence, well-cited)
- **Good**: 60-79 (adequate support, some uncertainty)
- **Poor**: 0-59 (low confidence, needs human review)

**2. Response Time** (milliseconds)
- L1 Tier: < 500ms (keyword search)
- L2 Tier: < 2000ms (semantic search)
- L3 Tier: < 5000ms (expert reasoning)

**3. Resolution Rate** (%)
- First Contact Resolution: % of questions answered without escalation
- Target: > 85%

**4. User Satisfaction**
- **CSAT** (Customer Satisfaction): 1-5 star rating
  - Target: > 4.0/5 average
- **NPS** (Net Promoter Score): 0-10 scale
  - Promoters (9-10): Highly satisfied
  - Passives (7-8): Neutral
  - Detractors (0-6): Dissatisfied
  - NPS = % Promoters - % Detractors
  - Target: > 30

**5. Tag Analysis**
- Auto-generated sentiment tags from user feedback:
  - Positive: "helpful", "fast", "accurate", "clear"
  - Negative: "confusing", "slow", "incomplete", "wrong"

**Quality Scoring System**:

**Automatic Scoring** (Step 11 in RAG pipeline):
```typescript
{
  conversationId: string;
  responseTime: number;        // milliseconds
  groundingScore: number;      // 0-100
  escalationTier: 'L1' | 'L2' | 'L3';
  resolved: boolean;           // true if user satisfied
  retrievalMetrics: {
    documentsFound: number;
    relevanceScores: number[];
    cacheHit: boolean;
  };
  generationMetrics: {
    tokensUsed: number;
    cost: number;
    validationPassed: boolean;
  };
}
```

**How to Review Quality**:

**Dashboard View**:
1. Navigate to Quality Metrics Dashboard
2. Review aggregate metrics:
   - Average grounding score trend
   - Response time percentiles
   - Resolution rate by department
3. Filter by:
   - Date range (7d/30d/90d)
   - Company (super admin)
   - Question category (benefits, enrollment, claims)

**Individual Conversation Review**:
1. Navigate to `/admin` → Conversations tab
2. Sort by:
   - Lowest grounding score (quality issues)
   - Longest response time (performance issues)
   - User rating (satisfaction issues)
3. Click a conversation to view details:
   - Full conversation transcript
   - AI reasoning (chain-of-thought)
   - Documents retrieved and relevance scores
   - Quality metrics
   - User feedback (if provided)
4. Mark for review or escalation if needed

**Quality Improvement Actions**:
- **Low Grounding Score**: Add more documents or improve document quality
- **High Response Time**: Optimize chunking, increase cache hit rate
- **Low Satisfaction**: Review feedback tags, improve prompts
- **High Escalation Rate**: Enhance L1/L2 tier coverage

---

### 5. 👥 User Management

**Location**: 
- Company Admin: `/company-admin/employees`
- Super Admin: `/super-admin/users`

**Description**: Manage employee access, permissions, and account status.

**Features**:
- ✅ **User List with Pagination**: View all users (20 per page)
- ✅ **Search and Filters**: Find users by name, email, role, department
- ✅ **Role Assignment**: Change user roles (Employee → HR Admin → Company Admin)
- ✅ **Account Status**: Activate, deactivate, or suspend accounts
- ✅ **Enrollment Tracking**: See which users completed benefits enrollment
- ✅ **Bulk Operations**: Update multiple users at once (super admin)
- ✅ **Audit Trail**: Track all user changes (who, when, what)

**User Roles & Permissions** (See [User Roles](#user-roles--permissions)):
1. **Employee**: Basic chat, calculator, documents
2. **HR Admin**: + Read-only analytics
3. **Company Admin**: + User management, document upload, full analytics
4. **Super Admin**: + Multi-company management, AI configuration

**User Table Columns**:
- Name
- Email
- Role
- Department
- Enrollment Status (Not Started, In Progress, Completed)
- Last Login
- Status (Active, Inactive, Suspended)
- Actions (Edit, Deactivate, Delete)

**How to Manage Users**:

**Add New User**:
1. Navigate to `/admin/users` or `/company-admin/employees`
2. Click "Add New User"
3. Fill in form:
   - Email (required, must be unique)
   - Name (required)
   - Role (Employee, HR Admin, Company Admin)
   - Department (optional)
4. Click "Send Invitation"
5. User receives email with setup link
6. User completes registration and sets password

**Change User Role**:
1. Find user in list (use search if needed)
2. Click "Edit" or click on the user row
3. Select new role from dropdown:
   - Employee → HR Admin (grants analytics access)
   - HR Admin → Company Admin (grants management access)
   - Company Admin → Super Admin (super admin only)
4. Click "Save"
5. User's permissions update immediately
6. Change is logged in audit trail

**Deactivate User**:
1. Find user in list
2. Click "Actions" → "Deactivate"
3. Confirm in modal dialog
4. User status changes to "Inactive"
5. User cannot log in (receives "Account disabled" message)
6. User data is retained (can be reactivated)

**Delete User** (Permanent):
1. Find user in list
2. Click "Actions" → "Delete"
3. Confirm deletion (warning: irreversible)
4. User account and data are permanently deleted
5. Action is logged in audit trail
6. Use with caution (consider deactivation instead)

**Bulk Operations** (Super Admin only):
1. Navigate to `/super-admin/users`
2. Select multiple users (checkboxes)
3. Click "Bulk Actions" dropdown:
   - Assign Role
   - Activate/Deactivate
   - Send Password Reset
   - Export to CSV
4. Confirm bulk action
5. Operation is applied to all selected users

**Search and Filters**:
- **Search**: Type name or email in search box
- **Role Filter**: Show only specific role
- **Status Filter**: Active, Inactive, Suspended
- **Department Filter**: Filter by department
- **Enrollment Status**: Not Started, In Progress, Completed

**Audit Trail**:
- All user changes are logged to `audit_logs` Cosmos container
- View audit trail in User Details → History tab:
  - Timestamp
  - Action (Created, Role Changed, Deactivated, etc.)
  - Performed By (admin user)
  - IP Address
  - Changes (before/after values)

---

### 6. ⚙️ System Settings

**Location**: 
- Company Admin: `/company-admin/settings`
- Super Admin: `/super-admin/ai-config`

**Description**: Configure application settings, integrations, and AI models.

**Settings Categories**:

#### A. **Company Settings** (`/company-admin/settings`)

**General**:
- Company Name
- Domain (for subdomain access)
- Logo Upload (for branding)
- Primary Color (theme customization)

**Features**:
- Enable/Disable Chat
- Enable/Disable Cost Calculator
- Enable/Disable Document Center
- Enable/Disable Plan Comparison

**Notifications**:
- Email Notifications (On/Off)
- Slack Integration (Webhook URL)
- Notification Preferences:
  - New User Registrations
  - Document Uploads
  - Quality Alerts
  - Cost Alerts

**Security**:
- Require MFA for Admins (On/Off)
- Session Timeout (15, 30, 60 minutes)
- Password Policy:
  - Minimum Length (8-16 characters)
  - Require Uppercase
  - Require Numbers
  - Require Special Characters
  - Password Expiration (30, 60, 90 days)

**Integrations** (`/company-admin/settings/integrations`):
- **Workday**: SSO configuration, API credentials
- **Microsoft Graph**: Azure AD integration
- **Slack**: Webhook for notifications
- **Custom API**: Webhook endpoints for events

---

#### B. **AI Configuration** (`/super-admin/ai-config`)

**Model Settings**:
- **Primary Model**: GPT-4, GPT-4-Turbo, GPT-3.5-Turbo
- **Temperature**: 0.0 (deterministic) to 1.0 (creative)
- **Max Tokens**: 500, 1000, 2000, 4000
- **Top-P**: Nucleus sampling (0.0-1.0)

**RAG Pipeline**:
- **L1 Tier (Keyword)**:
  - Enable/Disable
  - Confidence Threshold (0.0-1.0)
  - Cache TTL (seconds)
- **L2 Tier (Semantic)**:
  - Enable/Disable
  - Confidence Threshold (0.0-1.0)
  - Max Documents Retrieved (1-10)
- **L3 Tier (Expert)**:
  - Enable/Disable
  - Enable Multi-hop Reasoning
  - Max Reasoning Steps (1-5)

- **Embeddings**:
- **Model**: text-embedding-3-large (preferred), text-embedding-3-small
- **Dimensions**: 3072 (3-large), 512/1536 (3-small)
- **Batch Size**: 10, 50, 100

**Guardrails**:
- **PII Detection**: Enable/Disable
- **Toxicity Filter**: Enable/Disable
- **Compliance Check**: GDPR, HIPAA
- **Output Validation**: Enable/Disable

**How to Configure AI**:
1. Navigate to `/super-admin/ai-config`
2. Select configuration category (Model, RAG, Embeddings, Guardrails)
3. Adjust settings using dropdowns and sliders
4. Click "Test Configuration" to validate
5. Click "Save" to apply changes
6. Changes take effect immediately (no restart required)
7. Monitor impact in Observability Dashboard

**Best Practices**:
- **Temperature**: Use 0.0-0.3 for factual benefits questions
- **Max Tokens**: 1000-2000 for most responses
- **L1 Confidence**: 0.7+ (70% confidence to skip L2)
- **L2 Max Documents**: 5-7 (balance quality vs. cost)
- **PII Detection**: Always enable for compliance
- **Guardrails**: Enable all for production

---

## 🔑 User Credentials

### Test Accounts

#### Employee Access
```
Email: employee@amerivet.com
Password: amerivet2024!
Role: Employee
Permissions: Chat, Calculator, Documents (view-only), Plan Comparison
```

#### HR Admin Access
```
Email: hradmin@amerivet.com
Password: amerivet2024!
Role: HR Admin
Permissions: All Employee features + Analytics (read-only)
```

#### Company Admin Access
```
Email: admin@amerivet.com
Password: admin2024!
Role: Company Admin
Permissions: All HR Admin features + User Management, Document Upload/Edit, Full Analytics
```

#### Super Admin Access
```
Email: superadmin@platform.com
Password: admin2024!
Role: Super Admin
Permissions: Platform-wide access, Multi-company management, AI Configuration
```

### Password Requirements

- **Minimum Length**: 8 characters
- **Complexity**: Must include:
  - At least 1 uppercase letter
  - At least 1 lowercase letter
  - At least 1 number
  - At least 1 special character (!@#$%^&*)
- **Expiration**: 90 days (configurable)
- **History**: Cannot reuse last 5 passwords

### MFA (Multi-Factor Authentication)

**Status**: Supported but optional (enable in Company Settings)

**Setup Process**:
1. Log in with email/password
2. Click "Security" in user menu
3. Click "Enable MFA"
4. Scan QR code with authenticator app (Google Authenticator, Authy, Microsoft Authenticator)
5. Enter 6-digit code to verify
6. Save backup codes (for account recovery)
7. MFA is now required for all future logins

---

## 📚 Feature Walkthroughs

### Employee Walkthrough: Ask a Benefits Question

**Scenario**: Employee wants to know their medical deductible

1. **Login**
   - Go to `http://localhost:8080` or production URL
   - Enter email: `employee@amerivet.com`
   - Enter password: `amerivet2024!`
   - Click "Sign In"

2. **Start Chat**
   - You're redirected to the home page (chat interface)
   - Chat input is at the bottom of the screen

3. **Ask Question**
   - Type: "What is my medical deductible?"
   - Press Enter or click Send icon
   - AI will process in 1-2 seconds

4. **Review Response**
   - AI response streams in real-time
   - Example: "Your medical deductible is $1,500 for individual coverage and $3,000 for family coverage under the Gold PPO plan."
   - Citations appear below (e.g., "Source: 2025 Medical Benefits Guide, page 3")

5. **View Source**
   - Click citation link to view source document
   - Document opens in preview modal

6. **Rate Response**
   - Click star rating (1-5 stars) below response
   - Optionally add feedback in text box
   - Click "Submit Feedback"

7. **Ask Follow-up**
   - Type: "What if I add my spouse?"
   - AI remembers context from previous question
   - Response: "Adding a spouse moves you to family coverage, which has a $3,000 deductible..."

---

### Admin Walkthrough: Upload and Manage Benefits Document

**Scenario**: Company Admin uploads a new benefit plan summary

1. **Login as Admin**
   - Go to `http://localhost:8080/login`
   - Enter email: `admin@amerivet.com`
   - Enter password: `admin2024!`
   - Click "Sign In"

2. **Navigate to Documents**
   - Click "Documents" in sidebar
   - Or go to `/company-admin/documents`

3. **Create New Document**
   - Click "Upload Document" or "Create New"
   - Choose "Benefit Plan Summary" template
   - Or upload PDF/DOCX file

4. **Edit Content (if using template)**
   - Document title: "2025 Medical Benefits - Gold PPO"
   - Document type: "Benefit Plan"
   - Category: "Medical"
   - Tags: "2025", "medical", "gold", "ppo"
   - Use rich text editor:
     - Add heading: "Plan Overview"
     - Add paragraph describing coverage
     - Insert table with costs:
       ```
       | Coverage Type | Employee Cost | Employer Contribution |
       |---------------|---------------|----------------------|
       | Individual    | $150/month    | $350/month           |
       | Family        | $400/month    | $600/month           |
       ```
     - Add bullet list of benefits
     - Insert links to provider network

5. **Save Document**
   - Click "Save" button
   - Document is saved as Version 1
   - Processing status shows "Pending"

6. **Wait for AI Processing**
   - Refresh page after 1-2 minutes
   - Processing status changes to "Processing" → "Ready"
   - Document is now searchable by AI

7. **Test in Chat**
   - Switch to employee view (or use different browser)
   - Ask: "What's covered under the Gold PPO plan?"
   - AI retrieves your newly uploaded document
   - Response includes information from your document with citation

8. **Edit Document Later**
   - Go back to `/company-admin/documents`
   - Find "2025 Medical Benefits - Gold PPO" in list
   - Click "Edit"
   - Make changes (e.g., update costs for 2026)
   - Add change description: "Updated 2026 premium rates"
   - Click "Save"
   - Document is now Version 2
   - Version 1 is preserved in history

9. **View Version History**
   - Click document → "Version History" tab
   - See both versions:
     - Version 1: Created on Oct 31, 2025 by admin@amerivet.com
     - Version 2: Updated on Nov 15, 2025 by admin@amerivet.com
   - Click "View" on Version 1 to see original
   - Click "Rollback to Version 1" if needed (creates Version 3)

---

### Admin Walkthrough: Monitor Quality Metrics

**Scenario**: Company Admin reviews AI quality and user satisfaction

1. **Login as Admin**
   - Email: `admin@amerivet.com`
   - Password: `admin2024!`

2. **Navigate to Analytics**
   - Click "Analytics" in sidebar
   - Or go to `/company-admin` → Analytics tab

3. **Review Quality Metrics Dashboard**
   - **KPI Cards** (top of page):
     - Total Conversations: 1,247 (this week)
     - Avg Response Time: 1.2s
     - Avg Grounding Score: 82 (Excellent)
     - First Contact Resolution: 87%
   
   - **Performance Tab**:
     - Response time trend: Stable at 1-1.5s
     - Cache hit rate: 62% (good)
   
   - **Quality Tab**:
     - Grounding distribution: 75% Excellent, 20% Good, 5% Poor
     - Escalation rate: 13% to L2, 2% to L3
   
   - **Satisfaction Tab**:
     - CSAT: 4.3/5 average (90% rated 4-5 stars)
     - NPS: 52 (65% Promoters, 13% Detractors)
     - Top feedback tags: "helpful" (45%), "fast" (38%), "accurate" (32%)

4. **Identify Issues**
   - Notice 5% of responses have "Poor" grounding scores
   - Click "Poor" slice in pie chart to filter
   - See list of conversations with low quality

5. **Review Low-Quality Conversation**
   - Click on conversation with grounding score 45
   - Read conversation:
     - User: "What's the deadline for FSA enrollment?"
     - AI: "I don't have specific information about FSA enrollment deadlines in the available documents."
     - Grounding score: 45 (Poor - AI admitted lack of knowledge)
   - Root cause: Missing FSA enrollment guide document

6. **Take Action**
   - Go to `/company-admin/documents`
   - Upload "FSA Enrollment Guide" with deadline information
   - Wait for processing (1-2 minutes)
   - Test question again in chat - AI now provides correct answer

7. **Monitor Costs**
   - Click "Cost" tab in Observability Dashboard
   - See cost breakdown:
     - L1 tier: $12/day (cheap, keyword search)
     - L2 tier: $78/day (moderate, semantic search)
     - L3 tier: $15/day (expensive but rare, expert reasoning)
     - Total: $105/day (~$3,150/month)
   - Set budget alert: $4,000/month
   - Receive email if exceeded

8. **Export Data**
   - Click "Export to CSV" in Executive Dashboard
   - Download contains:
     - Daily conversation counts
     - Average satisfaction scores
     - Cost per day
     - Top topics
   - Share with stakeholders in monthly report

---

## 🐛 Troubleshooting

### Common Issues

#### Issue: "Cannot login - Invalid credentials"
**Solution**:
1. Verify you're using correct test credentials:
   - Employee: `employee@amerivet.com` / `amerivet2024!`
   - Admin: `admin@amerivet.com` / `admin2024!`
2. Check for extra spaces in email/password
3. Ensure Caps Lock is off
4. Clear browser cache and cookies
5. Try incognito/private browsing mode

#### Issue: "AI response is slow (> 5 seconds)"
**Causes**:
- L3 tier escalation (complex question requiring expert reasoning)
- Large document retrieval (many documents to process)
- High server load

**Solutions**:
1. Check which tier was used (shown in response metadata)
2. If L3 tier: Question may be too complex, try breaking into smaller questions
3. If L2 tier: Improve document quality/relevance
4. If L1 tier: Network latency issue, check internet connection

#### Issue: "Document not appearing in AI responses"
**Causes**:
- Document still processing (status: "Pending" or "Processing")
- Document failed to process (status: "Failed")
- Document not relevant to question

**Solutions**:
1. Check processing status: `/company-admin/documents` → Status column
2. If "Processing": Wait 1-2 more minutes, refresh page
3. If "Failed": Re-upload document or check error logs
4. If "Ready" but not retrieved: Improve document title/content with relevant keywords

#### Issue: "Rate limit exceeded"
**Causes**:
- Too many requests from same IP address
- Exceeded tier limit (100/min for Free, 500/min for Professional)

**Solutions**:
1. Wait 60 seconds for rate limit to reset
2. Check rate limit headers in browser dev tools (X-RateLimit-Remaining)
3. Upgrade tier if consistently hitting limits
4. Use pagination for bulk operations

#### Issue: "Cannot upload document"
**Causes**:
- File too large (> 10 MB)
- Unsupported file type
- Storage quota exceeded

**Solutions**:
1. Check file size (must be < 10 MB)
2. Supported types: PDF, DOCX, TXT, CSV
3. Compress PDF if too large
4. Contact admin if storage quota exceeded

#### Issue: "Analytics dashboard shows no data"
**Causes**:
- No conversations yet (new account)
- Time range filter excludes data
- Database connection issue

**Solutions**:
1. Have at least 1 conversation to populate metrics
2. Adjust time range filter (try "7 days" or "30 days")
3. Refresh page (data auto-refreshes every 30s)
4. Check browser console for errors (F12)

#### Issue: "User cannot be assigned Company Admin role"
**Causes**:
- Insufficient permissions (only Super Admin can assign)
- User already has higher role
- Company reached user limit

**Solutions**:
1. Log in as Super Admin (`superadmin@platform.com`)
2. Verify user's current role
3. Check company tier limits in `/super-admin/companies`
4. Upgrade company plan if needed

---

### Getting Help

**Documentation**: See `/docs` folder for comprehensive guides
**GitHub Issues**: [Report bugs or request features](https://github.com/sonalmogra28/benefitsaiAssisstantchatbot/issues)
**Email Support**: support@benefitsai.com
**Slack**: #benefits-ai-support

---

**Last Updated**: October 31, 2025  
**Version**: 3.1.0  
**Document**: User Access Guide
