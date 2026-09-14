import { ShieldCheck } from "lucide-react";
import Image from "next/image";
import styles from "./booking.module.css";

export default function PublicBookingHeader({ secureLink = false }: { secureLink?: boolean }) {
  return (
    <header className={styles.publicHeader}>
      <a className={styles.brand} href="/client-site" aria-label="Там где масло — на главную">
        <Image src="/brand/logo-wordmark-white.svg" width={204} height={30} priority alt="Там где масло." />
      </a>
      <div className={styles.headerActions}>
        <a href="/client-site">На сайт</a>
        <ShieldCheck aria-hidden />
        <span>{secureLink ? "Защищённая ссылка" : "Онлайн-запись"}<br /><small>{secureLink ? "доступ только к этой записи" : "без звонка и регистрации"}</small></span>
      </div>
    </header>
  );
}
