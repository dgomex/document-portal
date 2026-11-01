import unittest

from portal_rows import cell, check_case, check_client, is_id, new_id

CLIENTS = [
    {"client_id": "CL-AAAAAA", "email": "ana@x.pt", "additional_emails": "marido@x.pt", "active": True},
    {"client_id": "CL-DDDDDD", "email": "diogo@x.pt", "active": "FALSE"},
]


class PortalRows(unittest.TestCase):
    def test_ids_match_the_portal_pattern_and_avoid_taken(self):
        for _ in range(200):
            self.assertTrue(is_id(new_id("CL"), "CL"))
        self.assertNotIn(new_id("CS", ["CS-000000"]), ["CS-000000"])
        self.assertFalse(is_id("CL-7K3Q9I", "CL"))  # I is not Crockford

    def test_client_ok(self):
        self.assertEqual(check_client({"name": "Bruno", "email": " Bruno@X.pt ", "language": "en"}, CLIENTS), [])

    def test_client_duplicate_email_in_main_or_additional_inactive_too(self):
        self.assertEqual(check_client({"name": "B", "email": "MARIDO@x.pt"}, CLIENTS),
                         ["email marido@x.pt already used by CL-AAAAAA (active)"])
        self.assertEqual(check_client({"name": "B", "email": "diogo@x.pt"}, CLIENTS),
                         ["email diogo@x.pt already used by CL-DDDDDD (inactive)"])

    def test_client_editing_itself_is_not_a_duplicate(self):
        self.assertEqual(check_client({"client_id": "CL-AAAAAA", "name": "Ana", "email": "ana@x.pt"}, CLIENTS), [])

    def test_client_bad_fields(self):
        self.assertEqual(check_client({"name": "", "email": "nope", "additional_emails": "a@x.pt; bad", "language": "fr"}),
                         ["name must be 1-120 characters", "invalid email: nope",
                          "invalid additional_emails: bad", "language must be pt, en or es"])

    def test_case_needs_an_active_known_client(self):
        self.assertEqual(check_case({"client_id": "CL-AAAAAA", "case_name": "Visto D7 – família"}, CLIENTS), [])
        self.assertEqual(check_case({"client_id": "CL-ZZZZZZ", "case_name": "X"}, CLIENTS), ["unknown client_id: CL-ZZZZZZ"])
        self.assertEqual(check_case({"client_id": "CL-DDDDDD", "case_name": "X"}, CLIENTS), ["client CL-DDDDDD is inactive"])
        self.assertEqual(check_case({"client_id": "CL-AAAAAA", "case_name": "X", "status": "pending"}, CLIENTS),
                         ["status must be open or closed"])

    def test_formula_injection(self):
        self.assertEqual(cell('=HYPERLINK("x")'), '\'=HYPERLINK("x")')
        self.assertEqual(cell("+351"), "'+351")
        self.assertEqual(cell("Ana"), "Ana")


if __name__ == "__main__":
    unittest.main()
