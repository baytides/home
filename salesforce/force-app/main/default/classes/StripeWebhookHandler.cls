/**
 * StripeWebhookHandler - REST endpoint for receiving Stripe webhooks
 * Handles donation events and creates/updates Salesforce records
 */
@RestResource(urlMapping='/stripe/webhook/*')
global with sharing class StripeWebhookHandler {

    /**
     * Handle incoming Stripe webhook events
     */
    @HttpPost
    global static void handleWebhook() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;

        try {
            String requestBody = req.requestBody.toString();
            String stripeSignature = req.headers.get('Stripe-Signature');

            // Parse the event
            Map<String, Object> event = (Map<String, Object>) JSON.deserializeUntyped(requestBody);
            String eventType = (String) event.get('type');
            Map<String, Object> data = (Map<String, Object>) event.get('data');
            Map<String, Object> eventObject = (Map<String, Object>) data.get('object');

            // Route to appropriate handler
            switch on eventType {
                when 'checkout.session.completed' {
                    handleCheckoutCompleted(eventObject);
                }
                when 'payment_intent.succeeded' {
                    handlePaymentSucceeded(eventObject);
                }
                when 'invoice.payment_succeeded' {
                    handleInvoicePaymentSucceeded(eventObject);
                }
                when 'customer.subscription.created' {
                    handleSubscriptionCreated(eventObject);
                }
                when 'customer.subscription.deleted' {
                    handleSubscriptionCancelled(eventObject);
                }
                when else {
                    System.debug('Unhandled event type: ' + eventType);
                }
            }

            res.statusCode = 200;
            res.responseBody = Blob.valueOf('{"received": true}');

        } catch (Exception e) {
            System.debug('Webhook error: ' + e.getMessage() + '\n' + e.getStackTraceString());
            res.statusCode = 500;
            res.responseBody = Blob.valueOf('{"error": "' + e.getMessage() + '"}');
        }
    }

    /**
     * Handle checkout.session.completed - main entry point for hosted checkout donations
     */
    private static void handleCheckoutCompleted(Map<String, Object> session) {
        String sessionId = (String) session.get('id');
        String customerEmail = (String) session.get('customer_email');
        String paymentStatus = (String) session.get('payment_status');
        String mode = (String) session.get('mode');

        // Get customer details
        Map<String, Object> customerDetails = (Map<String, Object>) session.get('customer_details');
        String customerName = customerDetails != null ? (String) customerDetails.get('name') : null;

        // Get amount
        Decimal amountTotal = session.get('amount_total') != null
            ? Decimal.valueOf(String.valueOf(session.get('amount_total'))) / 100
            : 0;

        // Get metadata
        Map<String, Object> metadata = (Map<String, Object>) session.get('metadata');

        if (paymentStatus == 'paid') {
            createDonationRecord(
                customerEmail,
                customerName,
                amountTotal,
                metadata,
                mode == 'subscription',
                sessionId
            );
        }
    }

    /**
     * Handle payment_intent.succeeded - for embedded checkout one-time donations
     */
    private static void handlePaymentSucceeded(Map<String, Object> paymentIntent) {
        String paymentIntentId = (String) paymentIntent.get('id');
        String receiptEmail = (String) paymentIntent.get('receipt_email');

        Decimal amount = paymentIntent.get('amount') != null
            ? Decimal.valueOf(String.valueOf(paymentIntent.get('amount'))) / 100
            : 0;

        Map<String, Object> metadata = (Map<String, Object>) paymentIntent.get('metadata');
        String donorName = metadata != null ? (String) metadata.get('donor_name') : null;

        createDonationRecord(
            receiptEmail,
            donorName,
            amount,
            metadata,
            false,
            paymentIntentId
        );
    }

    /**
     * Handle invoice.payment_succeeded - for recurring subscription payments
     */
    private static void handleInvoicePaymentSucceeded(Map<String, Object> invoice) {
        String invoiceId = (String) invoice.get('id');
        String customerEmail = (String) invoice.get('customer_email');
        String subscriptionId = (String) invoice.get('subscription');

        Decimal amountPaid = invoice.get('amount_paid') != null
            ? Decimal.valueOf(String.valueOf(invoice.get('amount_paid'))) / 100
            : 0;

        // Get subscription metadata from subscription_details if available
        Map<String, Object> subscriptionDetails = (Map<String, Object>) invoice.get('subscription_details');
        Map<String, Object> metadata = subscriptionDetails != null
            ? (Map<String, Object>) subscriptionDetails.get('metadata')
            : null;

        createDonationRecord(
            customerEmail,
            null,
            amountPaid,
            metadata,
            true,
            invoiceId
        );
    }

    /**
     * Handle customer.subscription.created
     */
    private static void handleSubscriptionCreated(Map<String, Object> subscription) {
        String subscriptionId = (String) subscription.get('id');
        String status = (String) subscription.get('status');

        System.debug('Subscription created: ' + subscriptionId + ' with status: ' + status);
        // Could create a recurring donation record here if needed
    }

    /**
     * Handle customer.subscription.deleted
     */
    private static void handleSubscriptionCancelled(Map<String, Object> subscription) {
        String subscriptionId = (String) subscription.get('id');

        System.debug('Subscription cancelled: ' + subscriptionId);
        // Could update donation record to mark as cancelled
    }

    /**
     * Create donation record in Salesforce
     */
    private static void createDonationRecord(
        String email,
        String donorName,
        Decimal amount,
        Map<String, Object> metadata,
        Boolean isRecurring,
        String stripeId
    ) {
        // Extract metadata fields
        String fund = metadata != null ? (String) metadata.get('fund') : 'General Fund';
        Boolean anonymous = metadata != null && metadata.get('anonymous') == 'true';
        String tributeType = metadata != null ? (String) metadata.get('tribute_type') : null;
        String tributeName = metadata != null ? (String) metadata.get('tribute_name') : null;
        String source = metadata != null ? (String) metadata.get('source') : 'website';

        // Find or create Contact
        Contact donor = findOrCreateContact(email, donorName);

        // Create Opportunity (Donation)
        Opportunity donation = new Opportunity();
        donation.Name = anonymous ? 'Anonymous Donation' : (donorName != null ? donorName : email) + ' - Donation';
        donation.Amount = amount;
        donation.StageName = 'Closed Won';
        donation.CloseDate = Date.today();
        donation.ContactId = donor.Id;
        donation.Description = buildDescription(fund, tributeType, tributeName, source, isRecurring);

        // Store Stripe ID for reference
        // Note: You may want to create a custom field for this
        donation.LeadSource = 'Website';

        insert donation;

        System.debug('Created donation: ' + donation.Id + ' for amount: ' + amount);
    }

    /**
     * Find existing contact or create new one
     */
    private static Contact findOrCreateContact(String email, String name) {
        if (String.isBlank(email)) {
            // Create anonymous contact
            Contact anonymous = new Contact();
            anonymous.LastName = 'Anonymous Donor';
            anonymous.Email = 'anonymous-' + DateTime.now().getTime() + '@baytides.org';
            insert anonymous;
            return anonymous;
        }

        // Try to find existing contact
        List<Contact> existing = [SELECT Id, FirstName, LastName, Email FROM Contact WHERE Email = :email LIMIT 1];

        if (!existing.isEmpty()) {
            return existing[0];
        }

        // Create new contact
        Contact newContact = new Contact();
        newContact.Email = email;

        if (String.isNotBlank(name)) {
            List<String> nameParts = name.split(' ', 2);
            newContact.FirstName = nameParts[0];
            newContact.LastName = nameParts.size() > 1 ? nameParts[1] : nameParts[0];
        } else {
            newContact.LastName = email.split('@')[0];
        }

        insert newContact;
        return newContact;
    }

    /**
     * Build description string for the opportunity
     */
    private static String buildDescription(String fund, String tributeType, String tributeName, String source, Boolean isRecurring) {
        List<String> parts = new List<String>();

        parts.add('Fund: ' + fund);
        parts.add('Source: ' + source);
        parts.add('Type: ' + (isRecurring ? 'Monthly Recurring' : 'One-time'));

        if (String.isNotBlank(tributeType) && tributeType != 'none') {
            String tributeLabel = tributeType == 'in_honor' ? 'In Honor Of' : 'In Memory Of';
            parts.add(tributeLabel + ': ' + (String.isNotBlank(tributeName) ? tributeName : 'Not specified'));
        }

        return String.join(parts, '\n');
    }
}