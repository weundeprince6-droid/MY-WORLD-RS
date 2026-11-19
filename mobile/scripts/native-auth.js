import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";

// Google natif sur Android/iOS, puis ouverture de session dans Firebase JS
// afin que Firestore continue d'utiliser la même instance Auth que l'application.
window.academyNativeGoogleSignIn = async (auth) => {
  const result = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });
  const idToken = result?.credential?.idToken;
  if (!idToken) throw new Error("Google n'a pas retourné de jeton d'identification.");
  return signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
};
