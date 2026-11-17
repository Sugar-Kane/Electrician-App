# Source inventory

Repository source inventory; regex-based, includes historical/replaced definitions and excludes dynamic SQL expansion. Not a complete live catalog.

## Tables

| Resource | Classification | Source | Verification |
|---|---|---|---|
| public.organizations | 1 tenant-owned business data | supabase/migrations/20260803161114_electrician_app_foundation.sql:5 | Live inspection blocked |
| public.organization_members | 1 tenant-owned business data | supabase/migrations/20260803161114_electrician_app_foundation.sql:18 | Live inspection blocked |
| public.customers | 1 tenant-owned business data | supabase/migrations/20260803161114_electrician_app_foundation.sql:28 | Live inspection blocked |
| public.properties | 1 tenant-owned business data | supabase/migrations/20260803161114_electrician_app_foundation.sql:46 | Live inspection blocked |
| public.technicians | 1 tenant-owned business data | supabase/migrations/20260803161114_electrician_app_foundation.sql:68 | Live inspection blocked |
| public.jobs | 1 tenant-owned business data | supabase/migrations/20260803161114_electrician_app_foundation.sql:84 | Live inspection blocked |
| public.blackout_periods | 1 tenant-owned business data | supabase/migrations/20260803161114_electrician_app_foundation.sql:112 | Live inspection blocked |
| public.service_settings | 3 tenant-specific configuration | supabase/migrations/20260803161114_electrician_app_foundation.sql:127 | Live inspection blocked |
| public.estimates | 1 tenant-owned business data | supabase/migrations/20260803161114_electrician_app_foundation.sql:146 | Live inspection blocked |
| public.invoices | 1 tenant-owned business data | supabase/migrations/20260803161114_electrician_app_foundation.sql:161 | Live inspection blocked |
| public.inventory_items | 1 tenant-owned business data | supabase/migrations/20260803161114_electrician_app_foundation.sql:179 | Live inspection blocked |
| public.activity_events | 1 tenant-owned business data | supabase/migrations/20260803161114_electrician_app_foundation.sql:195 | Live inspection blocked |
| public.conversations | 1 tenant-owned business data | supabase/migrations/20260803173933_messaging_foundation.sql:11 | Live inspection blocked |
| public.messages | 1 tenant-owned business data | supabase/migrations/20260803173933_messaging_foundation.sql:27 | Live inspection blocked |
| public.message_templates | 3 tenant-specific configuration | supabase/migrations/20260803173933_messaging_foundation.sql:50 | Live inspection blocked |
| public.messaging_settings | 3 tenant-specific configuration | supabase/migrations/20260803173933_messaging_foundation.sql:66 | Live inspection blocked |
| public.messaging_consent | 1 tenant-owned business data | supabase/migrations/20260803173933_messaging_foundation.sql:86 | Live inspection blocked |
| public.supplier_product_selections | 1 tenant-owned business data | supabase/migrations/20260803180324_supplier_product_selections.sql:1 | Live inspection blocked |
| public.tenant_legal_pages | 3 tenant-specific configuration | supabase/migrations/20260803183832_tenant_legal_pages_public_table.sql:11 | Live inspection blocked |
| public.booking_intakes | 1 tenant-owned business data | supabase/migrations/20260804030816_public_customer_booking.sql:1 | Live inspection blocked |
| public.payments | 1 tenant-owned business data | supabase/migrations/20260804030816_public_customer_booking.sql:50 | Live inspection blocked |
| public.stripe_connect_accounts | 1 tenant-owned business data | supabase/migrations/20260804040637_stripe_connect_and_invoicing_foundation.sql:1 | Live inspection blocked |
| public.stripe_customers | 1 tenant-owned business data | supabase/migrations/20260804040637_stripe_connect_and_invoicing_foundation.sql:24 | Live inspection blocked |
| public.stripe_webhook_events | 1 tenant-owned business data | supabase/migrations/20260804040637_stripe_connect_and_invoicing_foundation.sql:40 | Live inspection blocked |
| public.document_integrations | 3 tenant-specific configuration | supabase/migrations/20260804042333_document_storage_and_cloud_sync.sql:1 | Live inspection blocked |
| public.document_folders | 1 tenant-owned business data | supabase/migrations/20260804042333_document_storage_and_cloud_sync.sql:21 | Live inspection blocked |
| public.documents | 1 tenant-owned business data | supabase/migrations/20260804042333_document_storage_and_cloud_sync.sql:36 | Live inspection blocked |
| public.document_cloud_links | 1 tenant-owned business data | supabase/migrations/20260804042333_document_storage_and_cloud_sync.sql:66 | Live inspection blocked |
| public.document_sync_jobs | 1 tenant-owned business data | supabase/migrations/20260804042333_document_storage_and_cloud_sync.sql:89 | Live inspection blocked |
| private.document_provider_credentials | 3 tenant-specific configuration | supabase/migrations/20260804042333_document_storage_and_cloud_sync.sql:115 | Live inspection blocked |
| public.user_profiles | 4 user-specific | supabase/migrations/20260804144538_user_profiles_preferences_billing_square.sql:1 | Live inspection blocked |
| public.user_preferences | 4 user-specific | supabase/migrations/20260804144538_user_profiles_preferences_billing_square.sql:14 | Live inspection blocked |
| public.organization_subscriptions | 1 tenant-owned business data | supabase/migrations/20260804144538_user_profiles_preferences_billing_square.sql:34 | Live inspection blocked |
| public.square_payment_accounts | 1 tenant-owned business data | supabase/migrations/20260804144538_user_profiles_preferences_billing_square.sql:60 | Live inspection blocked |
| public.tenant_legal_pages | 3 tenant-specific configuration | supabase/migrations/20260804191500_tenant_legal_pages_and_sms_consent.sql:25 | Live inspection blocked |
| public.sms_booking_requests | 1 tenant-owned business data | supabase/migrations/20260808020000_sms_booking_requests.sql:14 | Live inspection blocked |
| public.voice_calls | 1 tenant-owned business data | supabase/migrations/20260809030000_voice_calls.sql:11 | Live inspection blocked |
| public.mcp_call_log | 1 tenant-owned business data | supabase/migrations/20260809210000_mcp_call_log.sql:19 | Live inspection blocked |
| public.organization_invitations | 1 tenant-owned business data | supabase/migrations/20260810040000_organization_invitations.sql:12 | Live inspection blocked |
| public.platform_admins | 5 platform-administrator-only | supabase/migrations/20260810050000_platform_admin.sql:18 | Live inspection blocked |
| public.platform_admin_audit | 5 platform-administrator-only | supabase/migrations/20260810050000_platform_admin.sql:65 | Live inspection blocked |
| public.impersonation_sessions | 5 platform-administrator-only | supabase/migrations/20260811010000_impersonation.sql:20 | Live inspection blocked |
| public.contract_templates | 3 tenant-specific configuration | supabase/migrations/20260812000000_contracts.sql:12 | Live inspection blocked |
| public.contracts | 1 tenant-owned business data | supabase/migrations/20260812000000_contracts.sql:26 | Live inspection blocked |
| public.job_line_items | 1 tenant-owned business data | supabase/migrations/20260812020000_job_line_items.sql:14 | Live inspection blocked |
| public.job_technician_progress | 1 tenant-owned business data | supabase/migrations/20260813000000_technician_job_progress.sql:24 | Live inspection blocked |
| public.assistant_memories | 1 tenant-owned business data | supabase/migrations/20260813040000_reconcile_applied_schema.sql:49 | Live inspection blocked |
| public.inbound_conversations | 1 tenant-owned business data | supabase/migrations/20260813040000_reconcile_applied_schema.sql:119 | Live inspection blocked |
| public.inbound_calls | 1 tenant-owned business data | supabase/migrations/20260813040000_reconcile_applied_schema.sql:137 | Live inspection blocked |
| public.inbound_messages | 1 tenant-owned business data | supabase/migrations/20260813040000_reconcile_applied_schema.sql:162 | Live inspection blocked |
| public.inbound_leads | 1 tenant-owned business data | supabase/migrations/20260813040000_reconcile_applied_schema.sql:178 | Live inspection blocked |
| public.inbound_numbers | 1 tenant-owned business data | supabase/migrations/20260813040000_reconcile_applied_schema.sql:207 | Live inspection blocked |
| public.technician_hours | 3 tenant-specific configuration | supabase/migrations/20260815120000_technician_hours.sql:13 | Live inspection blocked |
| public.organization_domains | 1 tenant-owned business data | supabase/migrations/20260816130000_tenant_booking_domains.sql:14 | Live inspection blocked |
| public.technician_date_hours | 3 tenant-specific configuration | supabase/migrations/20260818120000_dated_hours.sql:18 | Live inspection blocked |
| public.mcp_business_credentials | 3 tenant-specific configuration | supabase/migrations/20260825050000_chatgpt_business_credentials_and_supplier_orders.sql:1 | Live inspection blocked |
| public.supplier_orders | 1 tenant-owned business data | supabase/migrations/20260825050000_chatgpt_business_credentials_and_supplier_orders.sql:19 | Live inspection blocked |
| public.supplier_order_items | 1 tenant-owned business data | supabase/migrations/20260825050000_chatgpt_business_credentials_and_supplier_orders.sql:48 | Live inspection blocked |
| public.inventory_movements | 1 tenant-owned business data | supabase/migrations/20260825120000_inventory_movements.sql:19 | Live inspection blocked |
| public.supply_stops | 1 tenant-owned business data | supabase/migrations/20260825130000_supply_stops.sql:15 | Live inspection blocked |
| public.journal_posts | 1 tenant-owned business data | supabase/migrations/20260826120000_journal_posts.sql:31 | Live inspection blocked |
| public.journal_post_revisions | 1 tenant-owned business data | supabase/migrations/20260826120000_journal_posts.sql:102 | Live inspection blocked |
| public.booking_calendar_connections | 3 tenant-specific configuration | supabase/migrations/20260930124714_google_calendar_paid_bookings.sql:2 | Live inspection blocked |
| public.booking_calendar_events | 1 tenant-owned business data | supabase/migrations/20260930124714_google_calendar_paid_bookings.sql:13 | Live inspection blocked |
| public.contract_signers | 1 tenant-owned business data | supabase/migrations/20261001014500_contractor_signatures.sql:21 | Live inspection blocked |
| public.site_videos | 2 shared platform configuration | supabase/migrations/20261002130000_site_videos.sql:11 | Live inspection blocked |
| public.buy_list_items | 1 tenant-owned business data | supabase/migrations/20261012150000_buy_list.sql:14 | Live inspection blocked |
| public.support_operations | 5 platform-administrator-only | supabase/migrations/20261012210000_support_operations.sql:67 | Live inspection blocked |
| public.support_cases | 5 platform-administrator-only | supabase/migrations/20261013030000_support_cases.sql:16 | Live inspection blocked |
| public.support_case_links | 5 platform-administrator-only | supabase/migrations/20261013030000_support_cases.sql:44 | Live inspection blocked |
| public.support_case_events | 5 platform-administrator-only | supabase/migrations/20261013030000_support_cases.sql:56 | Live inspection blocked |
| public.website_intake_keys | 1 tenant-owned business data | supabase/migrations/20261013050000_website_intake.sql:13 | Live inspection blocked |
| public.invoice_payments | 1 tenant-owned business data | supabase/migrations/20261014010000_job_steps.sql:34 | Live inspection blocked |
| public.organization_ai_keys | 1 tenant-owned business data | supabase/migrations/20261014020000_materials_chat.sql:12 | Live inspection blocked |
| public.job_material_lists | 1 tenant-owned business data | supabase/migrations/20261014020000_materials_chat.sql:31 | Live inspection blocked |
| public.invoice_online_payments | 1 tenant-owned business data | supabase/migrations/20261028160000_invoice_online_payments.sql:17 | Live inspection blocked |
| public.ai_usage | 1 tenant-owned business data | supabase/migrations/20261104230000_ai_usage.sql:12 | Live inspection blocked |
| public.platform_settings | 2 shared platform configuration | supabase/migrations/20261104233000_ai_allowance_settings.sql:17 | Live inspection blocked |
| public.organization_ai_allowances | 1 tenant-owned business data | supabase/migrations/20261104233000_ai_allowance_settings.sql:44 | Live inspection blocked |
| public.tasks | 1 tenant-owned business data | supabase/migrations/20261107010000_tasks.sql:14 | Live inspection blocked |
| public.task_activity | 1 tenant-owned business data | supabase/migrations/20261107010000_tasks.sql:167 | Live inspection blocked |
| public.task_series | 1 tenant-owned business data | supabase/migrations/20261107020000_task_scheduling.sql:26 | Live inspection blocked |
| public.task_work | 1 tenant-owned business data | supabase/migrations/20261107020000_task_scheduling.sql:99 | Live inspection blocked |
| public.task_notifications | 1 tenant-owned business data | supabase/migrations/20261107020000_task_scheduling.sql:124 | Live inspection blocked |
| public.assistant_connections | 3 tenant-specific configuration | supabase/migrations/20261107030000_task_assistants.sql:10 | Live inspection blocked |
| public.task_executions | 1 tenant-owned business data | supabase/migrations/20261107030000_task_assistants.sql:70 | Live inspection blocked |
| public.task_proposals | 1 tenant-owned business data | supabase/migrations/20261107030000_task_assistants.sql:120 | Live inspection blocked |
| public.job_visits | 1 tenant-owned business data | supabase/migrations/20261111040000_job_visits.sql:13 | Live inspection blocked |
| public.invoice_refunds | 1 tenant-owned business data | supabase/migrations/20261112010000_invoice_refunds.sql:15 | Live inspection blocked |
| public.booking_payment_refunds | 1 tenant-owned business data | supabase/migrations/20261114070000_booking_payment_refunds.sql:23 | Live inspection blocked |
| public.automation_events | 1 tenant-owned business data | supabase/migrations/20261115000000_supervised_actions.sql:33 | Live inspection blocked |
| public.supervised_action_audit | 1 tenant-owned business data | supabase/migrations/20261115000000_supervised_actions.sql:232 | Live inspection blocked |

## API routes and server actions

| Surface | Exports | Verification |
|---|---|---|
| src/app/account/actions.ts | updateProfile, uploadAvatar, removeAvatar, updatePreferences, updateSquareAccount, startPremiumCheckout, openBillingPortal, updatePassword, signOut | Not end-to-end verified |
| src/app/address-actions.ts | suggestAddresses, resolveAddress | Not end-to-end verified |
| src/app/admin/ai/actions.ts | setBusinessAiAllowance, setDefaultAiLimit | Not end-to-end verified |
| src/app/admin/cases/actions.ts | openCase, editCase, moveCase, assignCase, noteCase | Not end-to-end verified |
| src/app/admin/front-page/actions.ts | addSiteVideo, updateSiteVideo, moveSiteVideo, removeSiteVideo | Not end-to-end verified |
| src/app/admin/impersonate/actions.ts | beginImpersonation, endImpersonation | Not end-to-end verified |
| src/app/admin/organizations/[id]/actions.ts | adminInvite, revealPrivateDetails, checkEmailDelivery, supportHideBooking, supportRestoreBooking, supportKeepOneBooking | Not end-to-end verified |
| src/app/admin/organizations/[id]/data-actions.ts | deleteOneRecord, wipeBusinessData, deleteBusiness, removeStrayFiles | Not end-to-end verified |
| src/app/admin/organizations/[id]/messages/[messageId]/actions.ts | checkDelivery, retryText, previewRecipient, applyRecipient | Not end-to-end verified |
| src/app/api/account/summary/route.ts | GET | Not end-to-end verified |
| src/app/api/admin/site-videos/upload/route.ts | POST | Not end-to-end verified |
| src/app/api/intake/website/route.ts | POST | Not end-to-end verified |
| src/app/api/integrations/google-calendar/callback/route.ts | GET | Not end-to-end verified |
| src/app/api/integrations/google-calendar/connect/route.ts | GET | Not end-to-end verified |
| src/app/api/integrations/google-drive/callback/route.ts | GET | Not end-to-end verified |
| src/app/api/integrations/google-drive/connect/route.ts | GET | Not end-to-end verified |
| src/app/api/jobs/[jobNumber]/materials-chat/route.ts | POST | Not end-to-end verified |
| src/app/api/mcp/[token]/route.ts | POST, GET, DELETE | Not end-to-end verified |
| src/app/api/messages/[messageId]/photos/[index]/route.ts | GET | Not end-to-end verified |
| src/app/api/messages/fingerprint/route.ts | GET | Not end-to-end verified |
| src/app/api/operations/proposals/[id]/decision/route.ts | POST | Not end-to-end verified |
| src/app/api/operations/proposals/[id]/reconcile/route.ts | POST | Not end-to-end verified |
| src/app/api/operations/worker/route.ts | POST | Not end-to-end verified |
| src/app/api/stripe/webhook/route.ts | POST | Not end-to-end verified |
| src/app/api/twilio/inbound/route.ts | POST | Not end-to-end verified |
| src/app/api/twilio/recording/route.ts | POST | Not end-to-end verified |
| src/app/api/twilio/recordings/[recordingSid]/route.ts | GET | Not end-to-end verified |
| src/app/api/twilio/status/route.ts | POST | Not end-to-end verified |
| src/app/api/twilio/transfer/route.ts | POST | Not end-to-end verified |
| src/app/api/twilio/voice/route.ts | POST | Not end-to-end verified |
| src/app/api/twilio/website-callback/amd/route.ts | POST | Not end-to-end verified |
| src/app/api/twilio/website-callback/route.ts | POST | Not end-to-end verified |
| src/app/api/twilio/website-callback/status/route.ts | POST | Not end-to-end verified |
| src/app/api/twilio/xai/route.ts | POST | Not end-to-end verified |
| src/app/api/xai/voice/route.ts | POST | Not end-to-end verified |
| src/app/assistant/agent-actions.ts | chatAction | Not end-to-end verified |
| src/app/assistant/attachment-actions.ts | createAssistantUpload, recordAssistantAttachment | Not end-to-end verified |
| src/app/auth/callback/route.ts | GET | Not end-to-end verified |
| src/app/book/[slug]/actions.ts | startPublicBooking | Not end-to-end verified |
| src/app/booking/[token]/pay/route.ts | GET | Not end-to-end verified |
| src/app/booking-requests/actions.ts | scheduleBookingRequest, dismissBookingRequest, hideNotService, restoreRequest, keepOneRequest, markDistinct | Not end-to-end verified |
| src/app/contract/[token]/actions.ts | signContract | Not end-to-end verified |
| src/app/customers/[customerId]/actions.ts | setCustomerLanguage, saveCustomerDetailsAction | Not end-to-end verified |
| src/app/files/version-actions.ts | restoreDocumentVersion, listDocumentVersions | Not end-to-end verified |
| src/app/inventory/actions.ts | saveInventoryItem, adjustStock, removeInventoryItem, createStockPhotoUpload, attachStockPhoto | Not end-to-end verified |
| src/app/inventory/receipt-actions.ts | createReceiptUpload, scanReceipt, saveReceipt | Not end-to-end verified |
| src/app/invite/[token]/actions.ts | acceptInvitation | Not end-to-end verified |
| src/app/invoice/[token]/pay/route.ts | POST | Not end-to-end verified |
| src/app/invoice/[token]/pdf/route.ts | GET | Not end-to-end verified |
| src/app/invoices/actions.ts | sendInvoice, sendInvoicePreview, recordInvoicePayment, deleteInvoice, regenerateInvoicePdf, recordPaidInHand, sendPaidInvoiceAction, closeOutJobAction, refundPaymentAction, sendRefundReceiptAction | Not end-to-end verified |
| src/app/jobs/[jobId]/actions.ts | updateJobPlace, updateJob, cancelJob, setJobDiagnosticFee, endVisitForReturnAction | Not end-to-end verified |
| src/app/jobs/[jobId]/assign-actions.ts | listCrew, assignTechnician | Not end-to-end verified |
| src/app/jobs/[jobId]/contract-actions.ts | generateContract, generateChangeOrder, rebuildContractPdf, sendSigningLink, completeContractDetails, signForBusiness | Not end-to-end verified |
| src/app/jobs/[jobId]/diagnostic-refund-actions.ts | refundDiagnosticFeeAction | Not end-to-end verified |
| src/app/jobs/[jobId]/estimate-send-actions.ts | sendEstimateAction | Not end-to-end verified |
| src/app/jobs/[jobId]/invoice-actions.ts | raiseInvoice | Not end-to-end verified |
| src/app/jobs/[jobId]/line-actions.ts | addJobLine, addListedParts, removeJobLine, saveTechnicianNotes, chooseDiagnosticOutcome, sendDiagnosticFeeInvoice | Not end-to-end verified |
| src/app/jobs/[jobId]/material-list-actions.ts | saveMaterialList, clearMaterialList | Not end-to-end verified |
| src/app/jobs/[jobId]/photo-actions.ts | createJobPhotoUpload, recordJobPhoto, removeJobPhoto | Not end-to-end verified |
| src/app/jobs/[jobId]/step-actions.ts | setMaterialsReady, setMaterialsBought | Not end-to-end verified |
| src/app/jobs/[jobId]/workflow-actions.ts | advanceJob | Not end-to-end verified |
| src/app/jobs/new/actions.ts | createJob | Not end-to-end verified |
| src/app/jobs/new/estimate-actions.ts | estimateWorkOrder | Not end-to-end verified |
| src/app/materials/actions.ts | addToBuyList, updateBuyItem, removeBuyItem | Not end-to-end verified |
| src/app/messages/actions.ts | sendConversationMessage, startConversation, archiveConversation, unarchiveConversation, deleteConversation, restoreConversation, setConversationAssistant | Not end-to-end verified |
| src/app/onboarding/actions.ts | createOwnerWorkspace | Not end-to-end verified |
| src/app/reports/export/route.ts | GET | Not end-to-end verified |
| src/app/reset-password/actions.ts | resetPassword | Not end-to-end verified |
| src/app/search/actions.ts | searchCustomers | Not end-to-end verified |
| src/app/settings/business/actions.ts | saveBusinessDetails | Not end-to-end verified |
| src/app/settings/business/booking-page-actions.ts | saveBrandColor, saveLogo, saveBookingDomain, checkBookingDomain, removeBookingDomain | Not end-to-end verified |
| src/app/settings/chatgpt/chatgpt-actions.ts | createChatGptConnection, revokeChatGptConnection | Not end-to-end verified |
| src/app/settings/contract/actions.ts | saveContractTemplate, saveContractSigner, removeContractSigner | Not end-to-end verified |
| src/app/settings/integrations/calendar-actions.ts | saveCalendarAccount, retryCalendarSync, disconnectCalendar | Not end-to-end verified |
| src/app/settings/integrations/website-actions.ts | createWebsiteKey, revokeWebsiteKey | Not end-to-end verified |
| src/app/settings/journal/actions.ts | setPostVisibility, askAssistantToEdit, undoLastEdit, writePostNow | Not end-to-end verified |
| src/app/settings/legal/actions.ts | saveTenantLegalPage | Not end-to-end verified |
| src/app/settings/messages/actions.ts | saveMessageTemplate | Not end-to-end verified |
| src/app/settings/notifications/actions.ts | saveOwnerNotifications | Not end-to-end verified |
| src/app/settings/payments/start/route.ts |  | Not end-to-end verified |
| src/app/settings/team/actions.ts | inviteTeammate, revokeInvitation, setTechnicianBilling | Not end-to-end verified |
| src/app/supply-stops/actions.ts | saveSupplyStop, makeDefaultSupplyStop, removeSupplyStop | Not end-to-end verified |
| src/app/technicians/actions.ts | setElectricianWorking, addSelfAsElectrician, matchBusinessHours, saveElectricianHours, saveBusinessHours, saveDateHours, clearDateHours, addBlackout, removeBlackout | Not end-to-end verified |
| src/app/whats-new/actions.ts | markReleaseSeen | Not end-to-end verified |

## MCP tool definitions

| Tool | Definition | Verification |
|---|---|---|
| look_up_caller | src/lib/booking-tool-rules.ts:65 | Not individually adversarially verified |
| list_open_slots | src/lib/booking-tool-rules.ts:82 | Not individually adversarially verified |
| get_intake_questions | src/lib/booking-tool-rules.ts:94 | Not individually adversarially verified |
| resend_booking_link | src/lib/booking-tool-rules.ts:106 | Not individually adversarially verified |
| book_visit | src/lib/booking-tool-rules.ts:132 | Not individually adversarially verified |
| log_non_service_call | src/lib/booking-tool-rules.ts:225 | Not individually adversarially verified |
| request_callback | src/lib/booking-tool-rules.ts:244 | Not individually adversarially verified |
| search_customers | src/lib/mcp-business-tools.ts:47 | Not individually adversarially verified |
| search_jobs | src/lib/mcp-business-tools.ts:58 | Not individually adversarially verified |
| weekly_business_update | src/lib/mcp-business-tools.ts:69 | Not individually adversarially verified |
| get_business_hours | src/lib/mcp-business-tools.ts:76 | Not individually adversarially verified |
| set_business_hours | src/lib/mcp-business-tools.ts:82 | Not individually adversarially verified |
| draft_estimate | src/lib/mcp-business-tools.ts:103 | Not individually adversarially verified |
| send_estimate | src/lib/mcp-business-tools.ts:115 | Not individually adversarially verified |
| list_invoices | src/lib/mcp-business-tools.ts:131 | Not individually adversarially verified |
| create_invoice | src/lib/mcp-business-tools.ts:144 | Not individually adversarially verified |
| send_invoice | src/lib/mcp-business-tools.ts:160 | Not individually adversarially verified |
| send_text | src/lib/mcp-business-tools.ts:176 | Not individually adversarially verified |
| draft_contract | src/lib/mcp-business-tools.ts:192 | Not individually adversarially verified |
| complete_contract_details | src/lib/mcp-business-tools.ts:208 | Not individually adversarially verified |
| send_contract_for_signature | src/lib/mcp-business-tools.ts:228 | Not individually adversarially verified |
| supplier_integration_status | src/lib/mcp-business-tools.ts:243 | Not individually adversarially verified |
| get_job_materials | src/lib/mcp-business-tools.ts:250 | Not individually adversarially verified |
| save_materials_list | src/lib/mcp-business-tools.ts:263 | Not individually adversarially verified |
| store_cart | src/lib/mcp-business-tools.ts:283 | Not individually adversarially verified |
| get_customer_details | src/lib/mcp-customer-tools.ts:36 | Not individually adversarially verified |
| update_customer | src/lib/mcp-customer-tools.ts:43 | Not individually adversarially verified |
| mark_invoice_paid | src/lib/mcp-paid-invoice-tools.ts:28 | Not individually adversarially verified |
| close_out_job | src/lib/mcp-paid-invoice-tools.ts:48 | Not individually adversarially verified |
| send_paid_invoice | src/lib/mcp-paid-invoice-tools.ts:60 | Not individually adversarially verified |
| list_feature_updates | src/lib/mcp-release-tools.ts:14 | Not individually adversarially verified |
| propose_action | src/lib/mcp-supervised-tools.ts:53 | Not individually adversarially verified |
| list_proposals | src/lib/mcp-supervised-tools.ts:75 | Not individually adversarially verified |
| get_proposal | src/lib/mcp-supervised-tools.ts:87 | Not individually adversarially verified |
| approve_proposal | src/lib/mcp-supervised-tools.ts:100 | Not individually adversarially verified |
| reject_proposal | src/lib/mcp-supervised-tools.ts:118 | Not individually adversarially verified |
| prepare_supplier_order | src/lib/mcp-supplier-order-tools.ts:15 | Not individually adversarially verified |
| list_supplier_orders | src/lib/mcp-supplier-order-tools.ts:30 | Not individually adversarially verified |
| submit_supplier_order | src/lib/mcp-supplier-order-tools.ts:41 | Not individually adversarially verified |
| list_text_conversations | src/lib/mcp-text-history.ts:36 | Not individually adversarially verified |
| get_text_conversation | src/lib/mcp-text-history.ts:51 | Not individually adversarially verified |
| today_plan | src/lib/mcp-workday-tools.ts:56 | Not individually adversarially verified |
| get_schedule | src/lib/mcp-workday-tools.ts:68 | Not individually adversarially verified |
| create_job | src/lib/mcp-workday-tools.ts:82 | Not individually adversarially verified |
| create_customer | src/lib/mcp-workday-tools.ts:114 | Not individually adversarially verified |
| add_job_lines | src/lib/mcp-workday-tools.ts:144 | Not individually adversarially verified |
| bill_job | src/lib/mcp-workday-tools.ts:175 | Not individually adversarially verified |
| reschedule_job | src/lib/mcp-workday-tools.ts:195 | Not individually adversarially verified |
| update_job_status | src/lib/mcp-workday-tools.ts:216 | Not individually adversarially verified |
| cancel_job | src/lib/mcp-workday-tools.ts:232 | Not individually adversarially verified |
