/**
 * Test class for StripeWebhookHandler
 */
@isTest
private class StripeWebhookHandlerTest {

    @isTest
    static void testCheckoutSessionCompleted() {
        // Create test webhook payload
        String payload = '{' +
            '"type": "checkout.session.completed",' +
            '"data": {' +
                '"object": {' +
                    '"id": "cs_test_123",' +
                    '"customer_email": "test@example.com",' +
                    '"payment_status": "paid",' +
                    '"mode": "payment",' +
                    '"amount_total": 5000,' +
                    '"customer_details": {' +
                        '"name": "John Doe"' +
                    '},' +
                    '"metadata": {' +
                        '"fund": "General Fund",' +
                        '"anonymous": "false",' +
                        '"source": "website"' +
                    '}' +
                '}' +
            '}' +
        '}';

        Test.startTest();

        RestRequest req = new RestRequest();
        req.requestURI = '/services/apexrest/stripe/webhook/';
        req.httpMethod = 'POST';
        req.requestBody = Blob.valueOf(payload);

        RestResponse res = new RestResponse();

        RestContext.request = req;
        RestContext.response = res;

        StripeWebhookHandler.handleWebhook();

        Test.stopTest();

        // Verify response
        System.assertEquals(200, res.statusCode);

        // Verify contact was created
        List<Contact> contacts = [SELECT Id, Email, FirstName, LastName FROM Contact WHERE Email = 'test@example.com'];
        System.assertEquals(1, contacts.size());
        System.assertEquals('John', contacts[0].FirstName);
        System.assertEquals('Doe', contacts[0].LastName);

        // Verify opportunity was created
        List<Opportunity> opps = [SELECT Id, Amount, StageName FROM Opportunity WHERE ContactId = :contacts[0].Id];
        System.assertEquals(1, opps.size());
        System.assertEquals(50.00, opps[0].Amount);
        System.assertEquals('Closed Won', opps[0].StageName);
    }

    @isTest
    static void testPaymentIntentSucceeded() {
        String payload = '{' +
            '"type": "payment_intent.succeeded",' +
            '"data": {' +
                '"object": {' +
                    '"id": "pi_test_123",' +
                    '"receipt_email": "donor@example.com",' +
                    '"amount": 10000,' +
                    '"metadata": {' +
                        '"fund": "Education Fund",' +
                        '"anonymous": "false",' +
                        '"donor_name": "Jane Smith",' +
                        '"source": "website_checkout"' +
                    '}' +
                '}' +
            '}' +
        '}';

        Test.startTest();

        RestRequest req = new RestRequest();
        req.requestURI = '/services/apexrest/stripe/webhook/';
        req.httpMethod = 'POST';
        req.requestBody = Blob.valueOf(payload);

        RestResponse res = new RestResponse();

        RestContext.request = req;
        RestContext.response = res;

        StripeWebhookHandler.handleWebhook();

        Test.stopTest();

        System.assertEquals(200, res.statusCode);

        List<Contact> contacts = [SELECT Id FROM Contact WHERE Email = 'donor@example.com'];
        System.assertEquals(1, contacts.size());

        List<Opportunity> opps = [SELECT Id, Amount FROM Opportunity WHERE ContactId = :contacts[0].Id];
        System.assertEquals(1, opps.size());
        System.assertEquals(100.00, opps[0].Amount);
    }

    @isTest
    static void testAnonymousDonation() {
        String payload = '{' +
            '"type": "checkout.session.completed",' +
            '"data": {' +
                '"object": {' +
                    '"id": "cs_test_anon",' +
                    '"customer_email": null,' +
                    '"payment_status": "paid",' +
                    '"mode": "payment",' +
                    '"amount_total": 2500,' +
                    '"customer_details": null,' +
                    '"metadata": {' +
                        '"fund": "General Fund",' +
                        '"anonymous": "true",' +
                        '"source": "website"' +
                    '}' +
                '}' +
            '}' +
        '}';

        Test.startTest();

        RestRequest req = new RestRequest();
        req.requestURI = '/services/apexrest/stripe/webhook/';
        req.httpMethod = 'POST';
        req.requestBody = Blob.valueOf(payload);

        RestResponse res = new RestResponse();

        RestContext.request = req;
        RestContext.response = res;

        StripeWebhookHandler.handleWebhook();

        Test.stopTest();

        System.assertEquals(200, res.statusCode);

        // Verify anonymous contact was created
        List<Contact> contacts = [SELECT Id, LastName FROM Contact WHERE LastName = 'Anonymous Donor'];
        System.assertEquals(1, contacts.size());
    }

    @isTest
    static void testTributeDonation() {
        String payload = '{' +
            '"type": "checkout.session.completed",' +
            '"data": {' +
                '"object": {' +
                    '"id": "cs_test_tribute",' +
                    '"customer_email": "tribute@example.com",' +
                    '"payment_status": "paid",' +
                    '"mode": "payment",' +
                    '"amount_total": 7500,' +
                    '"customer_details": {' +
                        '"name": "Memorial Donor"' +
                    '},' +
                    '"metadata": {' +
                        '"fund": "Memorial Fund",' +
                        '"anonymous": "false",' +
                        '"tribute_type": "in_memory",' +
                        '"tribute_name": "John Smith",' +
                        '"source": "website"' +
                    '}' +
                '}' +
            '}' +
        '}';

        Test.startTest();

        RestRequest req = new RestRequest();
        req.requestURI = '/services/apexrest/stripe/webhook/';
        req.httpMethod = 'POST';
        req.requestBody = Blob.valueOf(payload);

        RestResponse res = new RestResponse();

        RestContext.request = req;
        RestContext.response = res;

        StripeWebhookHandler.handleWebhook();

        Test.stopTest();

        System.assertEquals(200, res.statusCode);

        List<Opportunity> opps = [SELECT Id, Description FROM Opportunity WHERE Amount = 75.00];
        System.assertEquals(1, opps.size());
        System.assert(opps[0].Description.contains('In Memory Of: John Smith'));
    }

    @isTest
    static void testRecurringSubscription() {
        String payload = '{' +
            '"type": "invoice.payment_succeeded",' +
            '"data": {' +
                '"object": {' +
                    '"id": "in_test_123",' +
                    '"customer_email": "monthly@example.com",' +
                    '"subscription": "sub_test_123",' +
                    '"amount_paid": 5000,' +
                    '"subscription_details": {' +
                        '"metadata": {' +
                            '"fund": "Monthly Giving",' +
                            '"anonymous": "false",' +
                            '"source": "website_checkout"' +
                        '}' +
                    '}' +
                '}' +
            '}' +
        '}';

        Test.startTest();

        RestRequest req = new RestRequest();
        req.requestURI = '/services/apexrest/stripe/webhook/';
        req.httpMethod = 'POST';
        req.requestBody = Blob.valueOf(payload);

        RestResponse res = new RestResponse();

        RestContext.request = req;
        RestContext.response = res;

        StripeWebhookHandler.handleWebhook();

        Test.stopTest();

        System.assertEquals(200, res.statusCode);

        List<Opportunity> opps = [SELECT Id, Description FROM Opportunity WHERE Amount = 50.00];
        System.assertEquals(1, opps.size());
        System.assert(opps[0].Description.contains('Monthly Recurring'));
    }

    @isTest
    static void testUnhandledEventType() {
        String payload = '{' +
            '"type": "some.unknown.event",' +
            '"data": {' +
                '"object": {}' +
            '}' +
        '}';

        Test.startTest();

        RestRequest req = new RestRequest();
        req.requestURI = '/services/apexrest/stripe/webhook/';
        req.httpMethod = 'POST';
        req.requestBody = Blob.valueOf(payload);

        RestResponse res = new RestResponse();

        RestContext.request = req;
        RestContext.response = res;

        StripeWebhookHandler.handleWebhook();

        Test.stopTest();

        // Should still return 200 for unhandled events
        System.assertEquals(200, res.statusCode);
    }
}