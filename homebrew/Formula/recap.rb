class Recap < Formula
  desc "Configurable project status dashboard for AI assistants"
  homepage "https://github.com/dohzya/tools"
  version "0.3.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.3.0/recap-darwin-arm64"
      sha256 "7521d0d0aad52afa959baba213447dd99c4921d332fe4788860dc8e214839a5b"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.3.0/recap-darwin-x86_64"
      sha256 "0699814f428338d056385510db9a7024340e446ff89fb23cff5314115f263c37"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.3.0/recap-linux-arm64"
      sha256 "3edb12d96d0a1036d4f76474b91b72d7808f03ba1fac267fc23a14196ebe364f"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.3.0/recap-linux-x86_64"
      sha256 "18d55eda56bdb1b9d542fe90d3a92992f9a4c5ff638ed09719d51cfc9124341d"
    end
  end

  def install
    binary_name = if OS.mac?
      if Hardware::CPU.arm?
        "recap-darwin-arm64"
      else
        "recap-darwin-x86_64"
      end
    else
      if Hardware::CPU.arm?
        "recap-linux-arm64"
      else
        "recap-linux-x86_64"
      end
    end

    bin.install binary_name => "recap"
  end

  test do
    system "#{bin}/recap", "--help"
  end
end
