import { Carousel } from "antd";
import { useEnterpriseStore } from "@/stores/modules/enterprise";
import "./Banner.css";

export function Banner() {
  const enterpriseStore = useEnterpriseStore();
  const { banner_info } = enterpriseStore;

  if (!banner_info?.url_list?.length) {
    return null;
  }

  const interval = banner_info.interval
    ? parseInt(String(banner_info.interval * 1000))
    : 5000;

  return (
    <div className="w-full flex-none">
      <Carousel
        arrows={banner_info.url_list.length > 1}
        dots={banner_info.url_list.length > 1}
        autoplay={banner_info.url_list.length > 1}
        dotPosition="bottom"
        autoplaySpeed={interval}
      >
        {banner_info.url_list.map((url: string, index: number) => (
          <div
            key={index}
            className="w-full !flex items-center justify-center banner-item"
          >
            <img
              src={url}
              className="object-cover max-w-full max-h-full"
              alt=""
            />
          </div>
        ))}
      </Carousel>
    </div>
  );
}

export default Banner;
